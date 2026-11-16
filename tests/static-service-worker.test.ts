import { afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
const temporary = await mkdtemp(join(tmpdir(), 'dripping-static-sw-'));
afterAll(() => rm(temporary, { recursive: true, force: true }));
await mkdir(join(temporary, 'dist/assets'), { recursive: true });
await mkdir(join(temporary, 'vendor/sheetscan'), { recursive: true });
await writeFile(
  join(temporary, 'dist/index.html'),
  '<html><head></head><body>current</body></html>',
);
await writeFile(join(temporary, 'dist/assets/current-ABC12345.js'), 'current module');
await writeFile(
  join(temporary, 'vendor/sheetscan/pin.json'),
  JSON.stringify({ version: 'v14-static-runtime' }),
);
execFileSync(process.execPath, [resolve('scripts/build-sw.mjs')], { cwd: temporary });
const script = await readFile(join(temporary, 'dist/sw.js'), 'utf8'),
  scope = 'https://dripping.test/dripping/';
function environment() {
  const stores = new Map<string, Map<string, Response>>(),
    listeners: Record<string, (event: any) => void> = {},
    network: string[] = [];
  let skipped = 0;
  const key = (request: any) => (typeof request === 'string' ? request : request.url);
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return {
        match: async (request: any, options?: { ignoreSearch?: boolean }) => {
          const url = new URL(key(request));
          if (options?.ignoreSearch) url.search = '';
          return store!.get(url.href)?.clone();
        },
        put: async (request: any, response: Response) => {
          store!.set(key(request), response);
        },
        addAll: async () => {},
      };
    },
  };
  const self = {
    registration: { scope },
    location: { origin: new URL(scope).origin },
    clients: { claim: async () => {} },
    skipWaiting: () => {
      skipped++;
    },
    addEventListener: (type: string, listener: (event: any) => void) => {
      listeners[type] = listener;
    },
  };
  const context = createContext({
    self,
    caches,
    URL,
    Response,
    Headers,
    fetch: async (request: any) => {
      network.push(request.url);
      return new Response('network', { status: 404 });
    },
  });
  runInContext(script, context);
  const names = runInContext('({PREFIX,CACHE,DEMAND,FILES})', context) as {
    PREFIX: string;
    CACHE: string;
    DEMAND: string;
    FILES: string[];
  };
  const put = async (name: string, path: string, body: string) =>
    (await caches.open(name)).put(new URL(path, scope).href, new Response(body));
  const dispatch = async (type: string, properties: any = {}) => {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners[type]({
      ...properties,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  };
  return { stores, caches, listeners, network, names, put, dispatch, skipped: () => skipped };
}
describe('static recognition service worker updates', () => {
  it('retains only one previous core cache and leaves verified model assets intact', async () => {
    const e = environment(),
      p = e.names.PREFIX;
    await e.put(p + 'dripping-oldest', 'assets/oldest-ABC12345.js', 'oldest');
    await e.put(p + 'dripping-previous', 'assets/previous-ABC12345.js', 'previous');
    await e.put(p + 'score-v13', 'old', 'old');
    await e.put('omr-assets-v1', 'vendor/sheetscan/v13/models/decoder.onnx', 'weights');
    await e.put(e.names.CACHE, 'index.html', 'current');
    await e.dispatch('activate');
    expect(await e.caches.keys()).toEqual([
      p + 'dripping-previous',
      'omr-assets-v1',
      e.names.CACHE,
    ]);
  });
  it('serves the current index even when an older cache was created first', async () => {
    const e = environment();
    await e.put(e.names.PREFIX + 'dripping-previous', 'index.html', 'old index');
    await e.put(e.names.CACHE, 'index.html', 'current index');
    const response = await e.dispatch('fetch', {
      request: { method: 'GET', mode: 'navigate', url: scope },
    });
    expect(await response!.text()).toBe('current index');
    expect(response!.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(e.network).toEqual([]);
  });
  it('keeps a previous immutable lazy module available without using old mutable files', async () => {
    const e = environment(),
      old = e.names.PREFIX + 'dripping-previous';
    await e.put(old, 'assets/pdf-import-ABC12345.js', 'old lazy module');
    await e.put(old, 'config.json', 'old config');
    await e.put(e.names.CACHE, 'index.html', 'current');
    const lazy = await e.dispatch('fetch', {
      request: { method: 'GET', mode: 'cors', url: scope + 'assets/pdf-import-ABC12345.js' },
    });
    expect(await lazy!.text()).toBe('old lazy module');
    expect(e.network).toEqual([]);
    const mutable = await e.dispatch('fetch', {
      request: { method: 'GET', mode: 'cors', url: scope + 'config.json' },
    });
    expect(mutable!.status).toBe(404);
    expect(e.network).toEqual([scope + 'config.json']);
  });
  it('reuses verified model cache while excluding recognition from ordinary precaching', async () => {
    const e = environment(),
      path = 'vendor/sheetscan/v13-woodwind-pdf/models/decoder.onnx';
    await e.put('omr-assets-v1', path, 'verified weights');
    const response = await e.dispatch('fetch', {
      request: { method: 'GET', mode: 'cors', url: scope + path },
    });
    expect(await response!.text()).toBe('verified weights');
    expect(e.network).toEqual([]);
    expect(e.names.FILES.some((path) => path.startsWith('vendor/'))).toBe(false);
  });
  it('activates an update only on the existing explicit activation message', async () => {
    const e = environment();
    expect(e.skipped()).toBe(0);
    await e.dispatch('message', { data: 'something else' });
    expect(e.skipped()).toBe(0);
    await e.dispatch('message', { data: 'ACTIVATE_UPDATE' });
    expect(e.skipped()).toBe(1);
  });
  it('falls through to the network if browser cache reads become unavailable', async () => {
    const e = environment();
    e.caches.open = async () => {
      throw new Error('Cache storage unavailable');
    };
    const url = scope + 'vendor/sheetscan/v14-static-runtime/runtime/pyodide/pyodide.mjs';
    const response = await e.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url } });
    expect(response!.status).toBe(404);
    expect(e.network).toEqual([url]);
  });
});
