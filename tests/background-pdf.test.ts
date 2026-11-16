// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import {
  newProject,
  saveProject,
  getAsset,
  exportProject,
  importProject,
} from '../src/lib/storage';
import { mergeImportedFiles } from '../src/lib/project';
import { clone, type Asset } from '../src/lib/types';
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('Blob', Blob);
it('restores a durable pending PDF before any XML or tempo exists', async () => {
  const p = newProject('Pending PDF'),
    id = crypto.randomUUID(),
    asset: Asset = {
      id,
      projectId: p.id,
      name: 'Original.pdf',
      type: 'application/pdf',
      blob: new Blob(['%PDF original']) as unknown as globalThis.Blob,
    };
  p.assetIds = [id];
  p.pdfSource = {
    version: 1,
    id: crypto.randomUUID(),
    assetIds: [id],
    state: 'pending',
    createdAt: p.createdAt,
  };
  await saveProject(p, [asset]);
  const restored = await importProject(await exportProject(p));
  expect(restored.score).toBeUndefined();
  expect(restored.scoreMap).toEqual([]);
  expect(restored.pdfSource?.state).toBe('pending');
  expect(restored.pdfSource?.assetIds[0]).not.toBe(id);
  expect(await (await getAsset(restored.pdfSource!.assetIds[0])).blob.text()).toBe('%PDF original');
});
it('merges newly decoded audio into the latest configuration rather than the old import snapshot', () => {
  const base = newProject('Before'),
    track = {
      id: 'original',
      name: 'Backing',
      role: 'backing' as const,
      sourceAssetId: 'a',
      clips: [],
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      offset: 0,
      color: 0,
    };
  base.tracks = [track];
  base.assetIds = ['a'];
  const latest = clone(base);
  latest.name = 'Renamed during import';
  latest.tracks[0].mute = true;
  latest.assetIds.push('result-xml');
  latest.tracks.push({ ...track, id: 'recording', name: 'New recording track', role: 'recording' });
  const prepared = clone(base);
  prepared.assetIds.push('b');
  prepared.tracks.push({
    ...track,
    id: 'added',
    sourceAssetId: 'b',
    name: 'Added Demo',
    role: 'demo',
  });
  const merged = mergeImportedFiles(base, latest, prepared);
  expect(merged.name).toBe(latest.name);
  expect(merged.tracks[0].mute).toBe(true);
  expect(merged.tracks.map((t) => t.id)).toEqual(['original', 'recording', 'added']);
  expect(merged.assetIds).toEqual(['a', 'result-xml', 'b']);
  expect(base.tracks[0].mute).toBe(false);
});
it('rejects attaching imported material to another project', () => {
  const p = newProject('A'),
    other = newProject('B');
  expect(() => mergeImportedFiles(p, other, p)).toThrow('Import project changed');
});
