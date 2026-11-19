"""Run the prepared production SDK and capture its observable browser stages."""

from base64 import b64decode, b64encode
from contextlib import contextmanager
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
from threading import Thread
from urllib.parse import urljoin

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parents[1]


class Host(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == '/__omr__/host.html':
            payload = b'<!doctype html><title>OMR regression host</title>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif self.path in ('/__omr__/browser-capture.js', '/__omr__/tuplet-probe.mjs'):
            payload = (TOOLS / self.path.rsplit('/', 1)[-1]).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            super().do_GET()


@contextmanager
def serve_sdk(root):
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Host, directory=str(root)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def launch(playwright, executable=None):
    # This host serves only repository assets and the frozen public inputs.
    return playwright.chromium.launch(executable_path=executable)


@contextmanager
def browser_page(browser, origin):
    context = browser.new_context(service_workers='block')
    errors = []

    def local_only(route):
        url = route.request.url
        if url.startswith((origin + '/', 'blob:' + origin + '/', 'data:')):
            route.continue_()
        else:
            errors.append(f'Unexpected request outside the SDK host: {url}')
            route.abort()

    context.route('**/*', local_only)
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin + '/__omr__/host.html')
        yield page, errors
    finally:
        context.close()


def recognize(browser, origin, pin, pdf_path, dest, shared=False):
    package_url = f'{origin}/{pin["version"]}/'
    with browser_page(browser, origin) as (page, errors):
        result = page.evaluate(
            "async input => (await import('/__omr__/browser-capture.js')).convert(input)",
            dict(sdkUrl=urljoin(package_url, 'sheetscan.js'),
                 modelBase=urljoin(package_url, pin.get('modelBase', './')),
                 name=pdf_path.name, pdf=b64encode(pdf_path.read_bytes()).decode(), shared=shared),
        )
        if errors:
            raise RuntimeError(f'Browser errors: {errors}')
    if (result['sdkVersion'], result['recognizerVersion']) != (pin['version'], pin['recognizerVersion']):
        raise ValueError('Loaded SDK versions do not match the repository pin')
    expected_bridge = 'shared memory' if shared else 'jspi'
    if result['bridge'] != expected_bridge:
        raise ValueError(f'Expected {expected_bridge}, got {result["bridge"]}')

    stages = {}
    for capture in result.pop('captures'):
        stage = {'result': 'worker', 'rests-repaired': 'rests-repaired'}[capture['type']]
        if stage in stages:
            raise ValueError(f'Duplicate {stage} message from SDK worker')
        stages[stage] = capture['xml']
    if 'worker' not in stages:
        raise ValueError('SDK did not return the initial Worker XML')
    stages['final'] = result.pop('xml')
    (dest / 'audit.json').write_text(json.dumps(result.pop('audit'), indent=2) + '\n', encoding='utf-8')
    files = {}
    for stage, xml in stages.items():
        name = stage + '.musicxml'
        payload = xml.encode()
        (dest / name).write_bytes(payload)
        files[stage] = {'file': name, 'sha256': sha256(payload).hexdigest()}
    rasters = []
    for index, raster in enumerate(result.pop('rasters'), 1):
        payload = b64decode(raster.pop('png'), validate=True)
        name = f'page-{index}.png'
        (dest / name).write_bytes(payload)
        rasters.append({**raster, 'file': name, 'sha256': sha256(payload).hexdigest()})
    if not rasters:
        raise ValueError('SDK returned no page rasters')
    return stages, {**result, 'stages': files, 'rasters': rasters}


def read_crops(browser, origin, sdk_root, pin, crops):
    workers = [name for name in pin['files'] if name.startswith('assets/omr.worker-')]
    if len(workers) != 1:
        raise ValueError('Expected a single pinned SDK recognition worker')
    worker = sdk_root / pin['version'] / workers[0]
    if sha256(worker.read_bytes()).hexdigest() != pin['files'][workers[0]]:
        raise ValueError('Prepared SDK worker does not match its pin')
    output = subprocess.check_output(['node', str(TOOLS / 'extract-worker-modules.mjs'), str(worker)])
    modules = json.loads(output)
    with browser_page(browser, origin) as (page, errors):
        result = page.evaluate(
            "async input => (await import('/__omr__/browser-capture.js')).readCrops(input)",
            dict(runtimeUrl=f'/{pin["version"]}/runtime/pyodide/', modules=modules, crops=crops),
        )
        if errors:
            raise RuntimeError(f'Browser errors: {errors}')
    return result['observations'], {name: sha256(text.encode()).hexdigest() for name, text in modules.items()}
