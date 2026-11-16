import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

function prepare(corruptPrevious = false) {
  const root = mkdtempSync(join(tmpdir(), 'sheetscan-retention-'));
  const put = (path: string, bytes: Uint8Array | string) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  };
  const current = Buffer.from('current runtime bytes'),
    previous = Buffer.from('previous runtime bytes');
  const sdk = 'const worker = "data:text/javascript;base64,ZXhwb3J0IHt9";';
  const manifest = (bytes: Uint8Array) => ({
    assets: [
      {
        path: 'engine.bin',
        url: 'https://example.invalid/engine.bin',
        bytes: bytes.length,
        sha256: sha(bytes),
      },
    ],
  });
  const currentManifest = JSON.stringify(manifest(current)),
    previousManifest = JSON.stringify(manifest(previous));
  const files = (runtime: string) => ({
    'sheetscan.js': sha(sdk),
    'runtime-lock.json': sha(runtime),
  });
  put(
    'scripts/prepare-sheetscan.mjs',
    readFileSync(new URL('../scripts/prepare-sheetscan.mjs', import.meta.url)),
  );
  put('vendor/sheetscan/sheetscan.js', sdk);
  put('vendor/sheetscan/runtime-lock.json', currentManifest);
  put('vendor/sheetscan/previous/sheetscan.js', sdk);
  put('vendor/sheetscan/previous/runtime-lock.json', previousManifest);
  put(
    'vendor/sheetscan/pin.json',
    JSON.stringify({
      version: 'v15',
      models: [],
      files: files(currentManifest),
      previous: { version: 'v14', models: [], files: files(previousManifest) },
    }),
  );
  put(`.cache/sheetscan/runtime/${sha(current)}`, current);
  put(
    `.cache/sheetscan/runtime/${sha(previous)}`,
    corruptPrevious ? Buffer.from('damaged') : previous,
  );
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  return { root, current, previous };
}

it('stages runtime assets for both current and retained lazy-loading SDKs using their own verified manifests', () => {
  const fixture = prepare();
  try {
    execFileSync(process.execPath, ['scripts/prepare-sheetscan.mjs'], { cwd: fixture.root });
    for (const [version, expected] of [
      ['v15', fixture.current],
      ['v14', fixture.previous],
    ] as const) {
      expect(
        readFileSync(join(fixture.root, `public/vendor/sheetscan/${version}/runtime/engine.bin`)),
      ).toEqual(expected);
      expect(
        readFileSync(
          join(fixture.root, `public/vendor/sheetscan/${version}/assets/pdf.worker.mjs`),
          'utf8',
        ),
      ).toBe('export {}');
    }
    // Repeating preparation can rebuild generated directories without network access.
    execFileSync(process.execPath, ['scripts/prepare-sheetscan.mjs'], { cwd: fixture.root });
    expect(
      readFileSync(join(fixture.root, 'public/vendor/sheetscan/v14/runtime/engine.bin')),
    ).toEqual(fixture.previous);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

it('rejects a corrupt retained runtime cache rather than serving it to an old SDK', () => {
  const fixture = prepare(true);
  try {
    expect(() =>
      execFileSync(process.execPath, ['scripts/prepare-sheetscan.mjs'], {
        cwd: fixture.root,
        stdio: 'pipe',
      }),
    ).toThrow('Cached runtime checksum mismatch');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
