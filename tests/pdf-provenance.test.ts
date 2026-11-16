// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { Blob } from 'node:buffer';
import { describe, it, expect, vi } from 'vitest';
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import {
  newProject,
  saveProject,
  getProject,
  getAsset,
  exportProject,
  importProject,
} from '../src/lib/storage';
import type { Asset } from '../src/lib/types';
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('Blob', Blob);
const fixture = () => {
  const p = newProject('Browser PDF'),
    asset = (name: string, type: string, content: string): Asset => ({
      id: crypto.randomUUID(),
      projectId: p.id,
      name,
      type,
      blob: new Blob([content]) as unknown as globalThis.Blob,
    }),
    assets = [
      asset('original.pdf', 'application/pdf', '%PDF original bytes'),
      asset('converted.musicxml', 'application/xml', '<score-partwise/>'),
      asset('audit.json', 'application/json', '{"source":"browser"}'),
    ];
  p.assetIds = assets.map((asset) => asset.id);
  p.scoreAssetId = assets[1].id;
  p.scoreConversion = {
    version: 1,
    engine: 'sheetscan',
    modelVersion: 'v11-natural-binding-r2',
    recognizerVersion: 'v11-natural-binding',
    sourceCommit: 'a'.repeat(40),
    bridge: 'jspi',
    createdAt: p.createdAt,
    originalAssetIds: [assets[0].id],
    musicxmlAssetId: assets[1].id,
    auditAssetId: assets[2].id,
  };
  return { p, assets };
};
describe('browser score conversion persistence', () => {
  it('restores original PDF, generated XML and audit with remapped references and exact bytes', async () => {
    const { p, assets } = fixture();
    await saveProject(p, assets);
    const restored = await importProject(await exportProject(p)),
      c = restored.scoreConversion!;
    expect(c.originalAssetIds[0]).not.toBe(assets[0].id);
    expect(c.musicxmlAssetId).toBe(restored.scoreAssetId);
    expect(c.sourceCommit).toBe(p.scoreConversion!.sourceCommit);
    for (const [index, id] of [c.originalAssetIds[0], c.musicxmlAssetId, c.auditAssetId].entries())
      expect(await (await getAsset(id)).blob.arrayBuffer()).toEqual(
        await assets[index].blob.arrayBuffer(),
      );
    expect((await getProject(p.id))!.scoreConversion).toEqual(p.scoreConversion);
  });
  it('rejects a backup whose conversion references omit source data', async () => {
    const { p, assets } = fixture();
    await saveProject(p, assets);
    const entries = unzipSync(new Uint8Array(await (await exportProject(p)).arrayBuffer())),
      m = JSON.parse(strFromU8(entries['manifest.json']));
    m.project.scoreConversion.originalAssetIds = ['missing'];
    entries['manifest.json'] = strToU8(JSON.stringify(m));
    await expect(
      importProject(new Blob([zipSync(entries)]) as unknown as globalThis.Blob),
    ).rejects.toThrow('Invalid score conversion provenance');
  });
  it('aborts the complete new project and source asset transaction when cancelled during writes', async () => {
    const { p, assets } = fixture(),
      controller = new AbortController(),
      put = IDBObjectStore.prototype.put,
      spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value,
        key,
      ) {
        const request = put.call(this, value, key);
        if (this.name === 'assets') controller.abort(new DOMException('Cancelled', 'AbortError'));
        return request;
      });
    try {
      await expect(saveProject(p, assets, controller.signal)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(await getProject(p.id)).toBeUndefined();
    for (const asset of assets)
      await expect(getAsset(asset.id)).rejects.toThrow('Missing project asset');
  });
  it('does not mutate an already saved project when the replacement transaction is cancelled', async () => {
    const { p, assets } = fixture();
    await saveProject(p, assets);
    const controller = new AbortController();
    controller.abort();
    await expect(
      saveProject({ ...p, name: 'Uncommitted replacement' }, [], controller.signal),
    ).rejects.toThrow();
    expect((await getProject(p.id))!.name).toBe('Browser PDF');
  });
});
