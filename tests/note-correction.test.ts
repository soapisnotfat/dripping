// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { changeNotePitch, undoProject } from '../src/lib/project';
import { correctWrittenPitch, parseScore, soundingEvents, writtenPitchAt } from '../src/lib/score';
import {
  exportProject,
  getAsset,
  getProject,
  importProject,
  newProject,
  saveProject,
} from '../src/lib/storage';
import { tempoMap } from '../src/lib/time';
import { referencePCM } from '../src/lib/reference';
import type { Asset } from '../src/lib/types';

vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('Blob', Blob);

const fixture = `<score-partwise version="4.0"><part-list>
  <score-part id="P1"><part-name>B-flat Clarinet</part-name></score-part>
  <score-part id="P2"><part-name>Flute</part-name></score-part>
</part-list>
<part id="P1"><measure number="1">
  <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
    <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
  <direction><sound tempo="96"/></direction>
  <note id="grace"><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
  <note id="start"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><type>quarter</type><notations><tied type="start"/></notations></note>
  <note id="chord"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note id="stop"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/></notations></note>
  <note id="rest"><rest/><duration>2</duration><type>half</type></note>
</measure></part>
<part id="P2"><measure number="1">
  <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
</measure></part></score-partwise>`;
const target = { step: 'F', alter: 1, octave: 4 };

it('corrects the full written tie while preserving voice, grace, chord and concert pitch', () => {
  const score = parseScore(fixture);
  const result = correctWrittenPitch(fixture, score, 'P1:0:3', target);
  expect(writtenPitchAt(result.xml, result.score, 'P1:0:1')).toEqual(target);
  expect(writtenPitchAt(result.xml, result.score, 'P1:0:3')).toEqual(target);
  expect(result.score.events.map((note) => [note.writtenMidi, note.midi, note.q])).toEqual([
    [62, 60, 0],
    [66, 64, 0],
    [64, 62, 0],
    [66, 64, 1],
    [null, null, 2],
  ]);
  expect(soundingEvents(result.score).map((note) => [note.midi, note.q, note.duration])).toEqual([
    [64, 0, 2],
    [62, 0, 1],
  ]);
  expect(parseScore(result.xml, 'P2').events).toEqual(parseScore(fixture, 'P2').events);
  const doc = new DOMParser().parseFromString(result.xml, 'application/xml');
  expect(doc.querySelector('#start > accidental')?.textContent).toBe('sharp');
  expect(doc.querySelector('#stop > accidental')).toBeNull();
  expect(doc.querySelector('#start > notations > tied')?.getAttribute('type')).toBe('start');
  expect(doc.querySelector('#stop > tie')?.getAttribute('type')).toBe('stop');
  expect(doc.querySelector('#chord > chord')).not.toBeNull();
  expect(doc.querySelector('#grace > grace')).not.toBeNull();
});

it('rejects a broken tie and leaves same-pitch edits out of history', () => {
  const broken = fixture.replace('<tie type="stop"/>', '').replace('<tied type="stop"/>', '');
  expect(() => correctWrittenPitch(broken, parseScore(broken), 'P1:0:1', target)).toThrow(
    'tie chain is ambiguous or incomplete',
  );
  const p = { ...newProject('Unchanged note'), score: parseScore(fixture), scoreXml: fixture };
  expect(changeNotePitch(p, 'P1:0:1', { step: 'C', alter: 0, octave: 4 })).toBe(p);
  expect(() => changeNotePitch(p, 'P1:0:4', target)).toThrow('Select a pitched note');
});

it('resynthesizes a sustained transposed tie at the corrected sounding frequency', () => {
  const p = newProject('Reference pitch');
  p.score = parseScore(fixture);
  p.scoreXml = fixture;
  p.scoreMap = tempoMap(p.score);
  const corrected = changeNotePitch(p, 'P1:0:3', target);
  const strength = (project: typeof p, midi: number) => {
    const {
      channels: [samples],
      sampleRate,
    } = referencePCM(project);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    let a = 0,
      b = 0;
    // Between beats two and three only the sustained tie is sounding.
    for (let i = Math.round(0.8 * sampleRate); i < Math.round(1.1 * sampleRate); i++) {
      const phase = (2 * Math.PI * frequency * i) / sampleRate;
      a += Math.sin(phase) * samples[i];
      b += Math.cos(phase) * samples[i];
    }
    return Math.hypot(a, b);
  };
  expect(strength(p, 58)).toBeGreaterThan(10 * strength(p, 64));
  expect(strength(corrected, 64)).toBeGreaterThan(10 * strength(corrected, 58));
});

it('persists edits and undo in portable backups with the original PDF and XML', async () => {
  const p = newProject('Pitch correction');
  p.score = parseScore(fixture);
  p.scoreXml = fixture;
  p.scoreMap = tempoMap(p.score);
  p.selection = { start: 0.625, end: 1.25 };
  p.loop = true;
  const assets: Asset[] = [
    ['pdf', 'application/pdf', '%PDF-1.7 original bytes'],
    ['xml', 'application/xml', fixture],
    ['audit', 'application/json', '{"source":"worker"}'],
    ['audio', 'audio/wav', 'test backing data'],
  ].map(([id, type, text]) => ({
    id,
    type,
    projectId: p.id,
    name: id,
    blob: new Blob([text]) as unknown as globalThis.Blob,
  }));
  p.assetIds = assets.map((asset) => asset.id);
  p.scoreAssetId = 'xml';
  p.scoreConversion = {
    version: 1,
    engine: 'sheetscan',
    modelVersion: 'test',
    recognizerVersion: 'test',
    sourceCommit: 'a'.repeat(40),
    bridge: 'jspi',
    createdAt: p.createdAt,
    originalAssetIds: ['pdf'],
    musicxmlAssetId: 'xml',
    auditAssetId: 'audit',
  };
  p.tracks = [
    {
      id: 'backing',
      name: 'Backing',
      role: 'backing',
      sourceAssetId: 'audio',
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      offset: 0,
      color: 0,
      clips: [],
      alignment: { method: 'score-phrases', status: 'accepted', anchors: p.scoreMap, warnings: [] },
    },
  ];
  const edited = changeNotePitch(p, 'P1:0:3', target);
  expect(edited.tracks[0].alignment?.status).toBe('candidate');
  expect(edited.scoreMap).toEqual(p.scoreMap);
  expect(edited.selection).toEqual(p.selection);
  expect(edited.loop).toBe(true);
  await saveProject(edited, assets);
  expect((await getProject(p.id))?.scoreXml).toBe(edited.scoreXml);
  const restored = await importProject(await exportProject(edited));
  expect(restored.scoreXml).toBe(edited.scoreXml);
  expect(await (await getAsset(restored.scoreConversion!.originalAssetIds[0])).blob.text()).toBe(
    '%PDF-1.7 original bytes',
  );
  expect(await (await getAsset(restored.scoreConversion!.musicxmlAssetId)).blob.text()).toBe(
    fixture,
  );
  const undone = undoProject(restored);
  expect(undone.scoreXml).toBe(fixture);
  expect(undone.tracks[0].alignment?.status).toBe('accepted');
  expect(undoProject(undone, true).scoreXml).toBe(edited.scoreXml);
});
