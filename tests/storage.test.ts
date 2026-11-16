// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { Blob } from 'node:buffer';
import { describe, it, expect, vi } from 'vitest';
import {
  newProject,
  saveProject,
  getProject,
  getAsset,
  exportProject,
  importProject,
  createSession,
  saveChunk,
  readSession,
  deleteSession,
  recoverySessions,
} from '../src/lib/storage';
import type { Asset, RecordingSession } from '../src/lib/types';
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('Blob', Blob);

describe('local persistence and recovery', () => {
  it('exports and restores all assets without overwriting the original project', async () => {
    const p = newProject('Round trip');
    const a: Asset = {
      id: crypto.randomUUID(),
      projectId: p.id,
      name: 'test.wav',
      type: 'audio/wav',
      blob: new Blob([new Uint8Array([1, 2, 3, 4])]) as unknown as globalThis.Blob,
    };
    p.assetIds = [a.id];
    p.tracks = [
      {
        id: 'track',
        name: 'Backing',
        role: 'backing',
        sourceAssetId: a.id,
        clips: [
          {
            id: 'clip',
            assetId: a.id,
            label: 'Audio',
            start: 0.37,
            end: 2.37,
            sourceStart: 1,
            rate: 1,
            gain: 1,
            fadeIn: 0,
            fadeOut: 0,
          },
        ],
        volume: 0.7,
        pan: -0.2,
        mute: false,
        solo: false,
        offset: 0,
        color: 0,
      },
    ];
    await saveProject(p, [a]);
    const archive = await exportProject(p),
      restored = await importProject(archive);
    expect(restored.id).not.toBe(p.id);
    expect(restored.tracks[0].clips[0]).toMatchObject({ start: 0.37, end: 2.37, sourceStart: 1 });
    expect(await (await getAsset(restored.assetIds[0])).blob.arrayBuffer()).toEqual(
      await a.blob.arrayBuffer(),
    );
    expect((await getProject(p.id))?.name).toBe('Round trip');
  });
  it('recovers only committed sequential PCM chunks after an interrupted take', async () => {
    const s: RecordingSession = {
      id: crypto.randomUUID(),
      projectId: 'p',
      trackId: 't',
      name: 'Interrupted',
      start: 3,
      speed: 0.75,
      sampleRate: 48000,
      channels: 1,
      createdAt: new Date().toISOString(),
      inputLabel: 'test',
      latencyMs: 0,
      chunks: 0,
      frames: 0,
    };
    await createSession(s);
    await saveChunk(s.id, 0, [new Float32Array([0.1, 0.2])]);
    await saveChunk(s.id, 1, [new Float32Array([0.3])]);
    const result = await readSession(s.id);
    expect(result.channels[0]).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    expect(result.session.frames).toBe(3);
    expect((await recoverySessions()).some((v) => v.id === s.id)).toBe(true);
    await deleteSession(s.id);
    expect((await recoverySessions()).some((v) => v.id === s.id)).toBe(false);
  });
  it('aborts project and asset writes together after a save failure and can retry the same snapshot', async () => {
    const p = newProject('Latest draft'),
      a: Asset = {
        id: crypto.randomUUID(),
        projectId: p.id,
        name: 'pending.wav',
        type: 'audio/wav',
        blob: new Blob([new Uint8Array([2, 4, 6])]) as unknown as globalThis.Blob,
      };
    p.assetIds = [a.id];
    const put = IDBObjectStore.prototype.put,
      fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value,
        key,
      ) {
        if (this.name === 'projects' && value.id === p.id)
          throw new DOMException('Simulated quota failure', 'QuotaExceededError');
        return put.call(this, value, key);
      });
    try {
      await expect(saveProject(p, [a])).rejects.toThrow('Simulated quota failure');
    } finally {
      fail.mockRestore();
    }
    expect(await getProject(p.id)).toBeUndefined();
    await expect(getAsset(a.id)).rejects.toThrow('Missing project asset');
    await saveProject(p, [a]);
    expect((await getProject(p.id))!.name).toBe('Latest draft');
    expect(await (await getAsset(a.id)).blob.arrayBuffer()).toEqual(await a.blob.arrayBuffer());
  });
  it('backs up unsaved audio from the current project without marking the draft persisted', async () => {
    const p = newProject('Saved before failure');
    await saveProject(p);
    const a: Asset = {
        id: crypto.randomUUID(),
        projectId: p.id,
        name: 'unsaved.wav',
        type: 'audio/wav',
        blob: new Blob([new Uint8Array([3, 5, 7, 9])]) as unknown as globalThis.Blob,
      },
      draft = { ...p, name: 'Unsaved region', assetIds: [a.id] };
    draft.tracks = [
      {
        id: 'track',
        name: 'Aligned',
        role: 'backing',
        sourceAssetId: a.id,
        clips: [
          {
            id: 'new-region',
            assetId: a.id,
            label: 'Aligned',
            start: 0,
            end: 1,
            sourceStart: 0,
            rate: 1,
            gain: 1,
            fadeIn: 0,
            fadeOut: 0,
          },
        ],
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        offset: 0,
        color: 0,
      },
    ];
    await expect(exportProject(draft)).rejects.toThrow('Missing project asset');
    const restored = await importProject(await exportProject(draft, [a]));
    expect(restored.tracks[0].clips[0].id).toBe('new-region');
    expect(await (await getAsset(restored.assetIds[0])).blob.arrayBuffer()).toEqual(
      await a.blob.arrayBuffer(),
    );
    expect((await getProject(p.id))!.name).toBe('Saved before failure');
    await expect(getAsset(a.id)).rejects.toThrow('Missing project asset');
    await expect(exportProject(draft, [{ ...a, projectId: 'another-project' }])).rejects.toThrow(
      'Missing project asset',
    );
  });
});
