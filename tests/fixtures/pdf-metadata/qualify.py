"""Optional developer check of the prepared baseline/candidate browser SDKs.
Requires Python Playwright and Chromium; no Python is used by the application.
"""
import argparse
import base64
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
repo = Path(__file__).resolve().parents[3]
parser.add_argument('--sdk-root', type=Path, default=repo / 'public/vendor/sheetscan')
parser.add_argument('--pin', type=Path, default=repo / 'vendor/sheetscan/pin.json')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
pin = json.loads(args.pin.read_text())
args.output.mkdir(parents=True, exist_ok=True)
data = base64.b64encode(Path(__file__).with_name('fixture.pdf').read_bytes()).decode()

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()
    def log_message(self, *_):
        pass
    def do_GET(self):
        if self.path == '/qualification-host.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<!doctype html><title>SDK qualification host</title>')
        else:
            super().do_GET()

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(args.sdk_root.resolve())))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
origin = f'http://127.0.0.1:{server.server_address[1]}'
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        try:
            runs = []
            for label, package, shared in [('baseline', pin['previous'], False), ('candidate', pin, False), ('candidate-shared', pin, True)]:
                page = browser.new_page()
                page.set_default_timeout(600000)
                page.on('console', lambda message: print(message.text, flush=True) if message.text.startswith('QUAL ') else None)
                page.goto(origin + '/qualification-host.html')
                result = page.evaluate('''async({version,modelBase,data,shared})=>{
                    const sdk=await import(`/${version}/sheetscan.js`), converter=sdk.createScoreConverter();
                    const before=location.href, registrations=(await navigator.serviceWorker.getRegistrations()).length;
                    let last='';
                    try {
                        const converted=await converter.convert([new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'fixture.pdf',{type:'application/pdf'})],{
                            modelBase:new URL(modelBase,new URL(`/${version}/`,location.href)).href,
                            forceSharedMemory:shared,
                            onProgress:e=>{const value=e.phase+':'+(e.text||'');if(value!==last&&['recognizing','text','rendering'].includes(e.phase)){last=value;console.log('QUAL '+version+' '+value)}}
                        });
                        const doc=new DOMParser().parseFromString(converted.musicxml,'application/xml');
                        if(location.href!==before||(await navigator.serviceWorker.getRegistrations()).length!==registrations)throw Error('SDK mutated host navigation/service workers');
                        return {sdkVersion:sdk.SDK_VERSION,recognizerVersion:sdk.RECOGNIZER_VERSION,bridge:converted.bridge,musicxml:converted.musicxml,
                            notes:[...doc.querySelectorAll('note')].map(n=>({pitch:n.querySelector('pitch')?.textContent.replace(/\\s/g,'')??null,duration:n.querySelector('duration')?.textContent??null,grace:!!n.querySelector('grace'),ties:[...n.querySelectorAll('tie')].map(t=>t.getAttribute('type'))})),
                            clefs:[...doc.querySelectorAll('clef')].map(n=>n.outerHTML),transpose:[...doc.querySelectorAll('transpose')].map(n=>n.outerHTML),tempos:[...doc.querySelectorAll('sound[tempo]')].map(n=>n.getAttribute('tempo'))};
                    } finally {converter.close()}
                }''', {'version': package['version'], 'modelBase': package.get('modelBase', './'), 'data': data, 'shared': shared})
                (args.output / (label + '.json')).write_text(json.dumps(result, indent=2) + '\n')
                (args.output / (label + '.musicxml')).write_text(result['musicxml'])
                print(label, result['bridge'], 'notes', len(result['notes']), 'clefs', len(result['clefs']), flush=True)
                runs.append(result)
                page.close()
            expected = [('C5','1'),('D5','1'),('E5','1'),('G5','1'),('F5','2'),('D5','2'),('C5','4')]
            assert [(n['pitch'], n['duration']) for n in runs[0]['notes']] == expected
            assert runs[0]['notes'] == runs[1]['notes'] == runs[2]['notes']
            assert len(runs[0]['clefs']) == 2 and len(runs[1]['clefs']) == len(runs[2]['clefs']) == 1
            assert not runs[0]['transpose'] and runs[1]['transpose'] == runs[2]['transpose']
            assert '<chromatic>-14</chromatic>' in runs[1]['transpose'][0]
            assert all(run['tempos'] == ['96'] for run in runs)
            print('PASS: written-note parity, opening-clef reduction, Tenor metadata, tempo, JSPI/shared parity', flush=True)
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
