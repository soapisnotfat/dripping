import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const source = new URL('../vendor/sheetscan/', import.meta.url),
  cache = new URL('../.cache/sheetscan/', import.meta.url);
const pin = JSON.parse(await readFile(new URL('pin.json', source), 'utf8')),
  root = new URL('../public/vendor/sheetscan/', import.meta.url),
  target = new URL(pin.version + '/', root),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(cache, { recursive: true });
await rm(root, { recursive: true, force: true });
await mkdir(target, { recursive: true });
async function put(url, bytes) {
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, bytes);
}
async function copyFiles(files, from, to) {
  for (const [name, hash] of Object.entries(files)) {
    let bytes = await readFile(new URL(name, from));
    if (sha(bytes) !== hash) throw Error('SheetScan vendored checksum mismatch: ' + name);
    if (name === 'sheetscan.js') {
      // PDF.js worker bytes stay exact, served with the host's self-only CSP.
      const text = bytes.toString(),
        pattern = /"data:text\/javascript;base64,([A-Za-z0-9+/=]+)"/;
      const match = text.match(pattern);
      if (!match) throw Error('Pinned PDF.js worker not found');
      await put(new URL('assets/pdf.worker.mjs', to), Buffer.from(match[1], 'base64'));
      bytes = Buffer.from(
        text.replace(pattern, "new URL('./assets/pdf.worker.mjs',import.meta.url).href"),
      );
    }
    await put(new URL(name, to), bytes);
  }
}
async function download(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw Error('HTTP ' + response.status);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3)
        throw Error(
          'Static resource download failed: ' + label + ' (' + url + '): ' + error.message,
        );
    }
}
function bundledNotice(bundle, asset) {
  const header = `\n${asset.path}\nSource: ${asset.url}\nSHA-256: ${asset.sha256}\n\n`,
    offset = bundle.indexOf(header);
  if (offset < 0) throw Error('Missing bundled runtime notice: ' + asset.path);
  const start = offset + Buffer.byteLength(header);
  return bundle.subarray(start, start + asset.bytes);
}
await copyFiles(pin.files, source, target);
// Retain exactly one prior released package for existing lazy-loading PWA tabs.
if (pin.previous) {
  const previousTarget = new URL(pin.previous.version + '/', root);
  await copyFiles(pin.previous.files, new URL('previous/', source), previousTarget);
  await put(
    new URL('pin.json', previousTarget),
    Buffer.from(JSON.stringify(pin.previous, null, 2) + '\n'),
  );
}
// Reuse the accepted v13 model URLs and raw-byte cache across SDK-only updates.
const modelTarget = new URL(pin.modelBase || './', target);
for (const model of pin.models) {
  const cached = new URL(model.sha256 + '.onnx', cache);
  let bytes;
  try {
    bytes = await readFile(cached);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (bytes && sha(bytes) !== model.sha256)
    throw Error('Cached model checksum mismatch: ' + model.name);
  if (!bytes) {
    console.log('Downloading pinned recognition model:', model.name);
    const archive = await download(model.url, model.name);
    if (sha(archive) !== model.archiveSha256)
      throw Error('Model archive checksum mismatch: ' + model.name);
    const entries = unzipSync(archive, { filter: (entry) => entry.name.endsWith('.onnx') });
    const names = Object.keys(entries);
    if (names.length !== 1) throw Error('Expected one ONNX in model archive');
    bytes = entries[names[0]];
    if (sha(bytes) !== model.sha256)
      throw Error('Recognition model checksum mismatch: ' + model.name);
    await writeFile(cached, bytes);
  }
  await put(new URL('models/' + model.name + '.onnx', modelTarget), bytes);
}
const runtime = JSON.parse(await readFile(new URL('runtime-lock.json', source), 'utf8'));
const runtimePackages = [{ manifest: runtime, target }];
// Retained SDKs resolve runtime files relative to their own package URL. Keep
// those files available as well; cached bytes are shared by verified SHA-256.
if (pin.previous?.files['runtime-lock.json'])
  runtimePackages.push({
    manifest: JSON.parse(await readFile(new URL('previous/runtime-lock.json', source), 'utf8')),
    target: new URL(pin.previous.version + '/', root),
  });
for (const pkg of runtimePackages) {
  // The verified notices bundle includes exact upstream bytes. This avoids
  // building against mutable or retired upstream license URLs.
  const notices = pkg.manifest.assets.some((asset) => asset.group === 'notice')
    ? await readFile(new URL('runtime-notices.txt', pkg.target))
    : null;
  for (let index = 0; index < pkg.manifest.assets.length; index += 3)
    await Promise.all(
      pkg.manifest.assets.slice(index, index + 3).map(async (asset) => {
        if (asset.path.startsWith('/') || asset.path.split('/').includes('..'))
          throw Error('Unsafe runtime path: ' + asset.path);
        const cached = new URL('runtime/' + asset.sha256, cache);
        let bytes;
        try {
          bytes = await readFile(cached);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (bytes && (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256))
          throw Error('Cached runtime checksum mismatch: ' + asset.path);
        if (!bytes) {
          bytes =
            asset.group === 'notice'
              ? bundledNotice(notices, asset)
              : await download(asset.url, asset.path);
          if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256)
            throw Error('Runtime checksum mismatch: ' + asset.path);
          await put(cached, bytes);
        }
        await put(new URL('runtime/' + asset.path, pkg.target), bytes);
      }),
    );
}
await put(new URL('pin.json', target), Buffer.from(JSON.stringify(pin, null, 2) + '\n'));
console.log(
  'Pinned SheetScan prepared:',
  pin.version,
  'runtime assets:',
  runtime.assets.length,
  'same-origin model set:',
  pin.modelBase || './',
);
