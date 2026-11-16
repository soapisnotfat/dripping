// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { Blob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import {
  newProject,
  saveProject,
  exportProject,
  importProject,
  getAsset,
} from '../src/lib/storage';
import { editProject, undoProject } from '../src/lib/project';
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('Blob', Blob);
import { pairWithinAlignment } from '../src/lib/alignment-edit';
import type { Alignment } from '../src/lib/types';
const fixture = (): Alignment => ({
  anchors: [
    { q: 0, seconds: -1 },
    { q: 2, seconds: 1 },
    { q: 4, seconds: 3 },
    { q: 6, seconds: 5 },
    { q: 8, seconds: 7 },
    { q: 10, seconds: 9 },
  ],
  anchorSources: [
    'extrapolated',
    'automatic',
    'automatic',
    'automatic',
    'automatic',
    'extrapolated',
  ],
  status: 'candidate',
  method: 'chroma-dtw',
  warnings: [],
  reference: {
    kind: 'score-part',
    scoreSignature: 'a'.repeat(64),
    partIds: ['P1'],
    pitch: 'xml',
    sampleRate: 48000,
  },
  assessment: {
    basis: 'score-notes',
    decision: 'review',
    supportedFraction: 0.8,
    reasons: ['unverified-score-notes'],
    unverified: [{ from: 4, to: 6 }],
    points: [
      { q: 2, sourceSample: 48000, midi: [65], support: 0.9, attack: 0.8 },
      { q: 4, sourceSample: 144000, midi: [62], support: 0.9, attack: 0.8 },
      { q: 8, sourceSample: 336000, midi: [60], support: 0.9, attack: 0.8 },
    ],
  },
});
it('holds a single actual source pair as a preview without shifting or refitting the automatic body', () => {
  const original = fixture(),
    one = pairWithinAlignment(original, 4.25, 3.5, 10, 12);
  expect(one.anchors).toEqual(original.anchors);
  expect(one.manualAnchors).toEqual([]);
  expect(one.manualPairs).toEqual([{ q: 4.25, seconds: 3.5 }]);
  expect(one.reference).toEqual(original.reference);
  expect(original.manualPairs).toBeUndefined();
  expect(one).toMatchObject({ method: 'manual', manualMode: 'local', status: 'candidate' });
});
it('rebuilds only the two-pair interval and preserves exterior automatic anchors and their provenance byte-for-byte', () => {
  const original = fixture(),
    one = pairWithinAlignment(original, 3, 2.5, 10, 12),
    two = pairWithinAlignment(one, 7, 5.5, 10, 12);
  expect(two.anchors).toEqual([
    { q: 0, seconds: -1 },
    { q: 2, seconds: 1 },
    { q: 3, seconds: 2.5 },
    { q: 7, seconds: 5.5 },
    { q: 8, seconds: 7 },
    { q: 10, seconds: 9 },
  ]);
  expect(two.anchorSources).toEqual([
    'extrapolated',
    'automatic',
    'manual',
    'manual',
    'automatic',
    'extrapolated',
  ]);
  expect(two.manualPairs).toHaveLength(2);
  expect(two.reference).toEqual(original.reference);
  expect(two.assessment!.points.map((point) => point.q)).toEqual([2, 8]);
  expect(two.assessment!.reasons).toContain('unverified-score-notes');
  expect(two.assessment!.unverified).toEqual([{ from: 4, to: 6 }]);
  expect(original.anchors[2]).toEqual({ q: 4, seconds: 3 });
});
it('adds an offbeat inside the same local correction without disturbing exterior anchors', () => {
  const one = pairWithinAlignment(fixture(), 3, 2.5, 10, 12),
    two = pairWithinAlignment(one, 7, 5.5, 10, 12),
    three = pairWithinAlignment(two, 4.5, 3.75, 10, 12);
  expect(three.manualPairs).toEqual([
    { q: 3, seconds: 2.5 },
    { q: 4.5, seconds: 3.75 },
    { q: 7, seconds: 5.5 },
  ]);
  expect(three.anchors.filter((point) => point.q < 3 || point.q > 7)).toEqual(
    fixture().anchors.filter((point) => point.q < 3 || point.q > 7),
  );
});
it('rejects conflict with exterior music without deleting points, clamping or mutating the preview', () => {
  const original = fixture(),
    one = pairWithinAlignment(original, 3, 2.5, 10, 12),
    before = structuredClone(one);
  expect(() => pairWithinAlignment(one, 7, 7.5, 10, 12)).toThrow('outside this span');
  expect(one).toEqual(before);
  expect(original.anchors).toHaveLength(6);
  expect(() => pairWithinAlignment(one, 7, 2, 10, 12)).toThrow();
});
it.each([
  [-1, 0],
  [11, 1],
  [2, -0.01],
  [2, 12],
  [2, Number.NaN],
])('does not count an invalid or inaudible pair q=%s source=%s', (q, seconds) => {
  const original = fixture();
  expect(() => pairWithinAlignment(original, q, seconds, 10, 12)).toThrow('audible source');
  expect(original.manualPairs).toBeUndefined();
});

it('round-trips mixed point provenance, pending pairs and unknown ranges through undo and asset-complete backup', async () => {
  const p = newProject('Mixed alignment'),
    id = crypto.randomUUID(),
    bytes = new Uint8Array([3, 1, 4, 1, 5, 9]),
    asset = {
      id,
      projectId: p.id,
      name: 'Original.wav',
      type: 'audio/wav',
      blob: new Blob([bytes]) as unknown as globalThis.Blob,
    };
  p.assetIds = [id];
  p.tracks = [
    {
      id: 'demo',
      name: 'Demo',
      role: 'demo',
      sourceAssetId: id,
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      offset: 0,
      color: 0,
      clips: [
        {
          id: 'region',
          assetId: id,
          label: 'Original',
          start: 0,
          end: 10,
          sourceStart: 0,
          rate: 1,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
      alignment: fixture(),
    },
  ];
  const one = pairWithinAlignment(p.tracks[0].alignment!, 3, 2.5, 10, 12),
    two = pairWithinAlignment(one, 7, 5.5, 10, 12),
    edited = editProject(p, 'align to score', (project) => {
      project.tracks[0].alignment = { ...two, status: 'accepted' };
    });
  await saveProject(edited, [asset]);
  const restored = await importProject(await exportProject(edited));
  expect(restored.tracks[0].alignment).toEqual({ ...two, status: 'accepted' });
  expect(undoProject(restored).tracks[0].alignment).toEqual(fixture());
  expect(undoProject(undoProject(restored), true).tracks[0].alignment!.manualPairs).toEqual(
    two.manualPairs,
  );
  expect(await (await getAsset(restored.assetIds[0])).blob.arrayBuffer()).toEqual(bytes.buffer);
  const pending = { ...p, tracks: p.tracks.map((track) => ({ ...track, alignment: one })) };
  expect(
    (await importProject(await exportProject(pending))).tracks[0].alignment!.manualPairs,
  ).toHaveLength(1);
});

it('rejects malformed local-pair, anchor-source and score-gap metadata on archive restore', async () => {
  for (const invalid of [
    { manualPairs: [{ q: 2, seconds: -1 }] },
    {
      manualPairs: [
        { q: 2, seconds: 1 },
        { q: 2, seconds: 2 },
      ],
    },
    { manualMode: 'global' },
    { anchorSources: ['automatic'] },
    {
      assessment: {
        ...fixture().assessment!,
        unverified: [
          { from: 2, to: 5 },
          { from: 4, to: 6 },
        ],
      },
    },
  ]) {
    const p = newProject('Malformed metadata');
    p.tracks = [
      {
        id: 'empty',
        name: 'Empty',
        role: 'recording',
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        offset: 0,
        color: 0,
        clips: [],
        alignment: { ...fixture(), ...invalid } as Alignment,
      },
    ];
    await expect(importProject(await exportProject(p))).rejects.toThrow();
  }
});
