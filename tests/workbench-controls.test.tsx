// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import type { Score, Track } from '../src/lib/types';
import { newProject } from '../src/lib/storage';
import { parseScore } from '../src/lib/score';
import { tempoMap } from '../src/lib/time';
import { audibleTrackIds } from '../src/lib/mix';
import { scorePositionLabel, musicalPositionAt, musicalPositionSeconds } from '../src/lib/time';
import { ExportDialog } from '../src/components/Dialogs';
import { SelectionEditor } from '../src/components/SelectionEditor';

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id,
  name: id,
  role: 'recording',
  clips: [
    {
      id: 'clip',
      assetId: id,
      label: id,
      start: 0,
      end: 4,
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
  ...patch,
});
const checkbox = (name: string) =>
  [...document.querySelectorAll('label')]
    .find((label) => label.textContent?.startsWith(name))!
    .querySelector('input')!;
const fill = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (label: string, value: string) => {
  const select = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};
const practice = (name: string) => {
  const project = newProject(name);
  project.score = parseScore(
    '<score-partwise><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="60"/></direction><note><rest measure="yes"/><duration>4</duration></note></measure><measure number="2"><note><rest measure="yes"/><duration>4</duration></note></measure></part></score-partwise>',
  );
  project.scoreMap = tempoMap(project.score);
  return project;
};
const changingMeter = {
  tempo: [
    { q: 0, bpm: 60 },
    { q: 4, bpm: 30 },
    { q: 6, bpm: 60 },
  ],
  totalQ: 7.5,
  measures: [{ beatType: 4 }, { beatType: 4 }, { beatType: 8 }],
  route: [
    { number: '1', measure: 0, q: 0, duration: 4, pass: 1 },
    { number: '2', measure: 1, q: 4, duration: 2, pass: 1 },
    { number: '3', measure: 2, q: 6, duration: 1.5, pass: 1 },
  ],
} as Score;
const changingMap = [
  { q: 0, seconds: 0 },
  { q: 4, seconds: 4 },
  { q: 6, seconds: 8 },
  { q: 7.5, seconds: 9.5 },
];

it('uses the same mute/solo rules for export selection and playback', () => {
  const tracks = [track('backing'), track('demo', { mute: true }), track('take')];
  expect(audibleTrackIds(tracks)).toEqual(['backing', 'take']);
  tracks[2].solo = true;
  expect(audibleTrackIds(tracks)).toEqual(['take']);
  tracks[2].mute = true;
  expect(audibleTrackIds(tracks)).toEqual([]);
});

it('defaults to audible tracks while retaining explicit export overrides', () => {
  const project = newProject('Export');
  project.tracks = [track('backing'), track('demo', { mute: true }), track('take')];
  act(() =>
    root.render(
      <ExportDialog project={project} locale="en" onClose={() => {}} onError={() => {}} />,
    ),
  );
  expect(checkbox('backing').checked).toBe(true);
  expect(checkbox('demo').checked).toBe(false);
  expect(checkbox('take').checked).toBe(true);
  act(() => checkbox('demo').click());
  expect(checkbox('demo').checked).toBe(true);
  expect(project.tracks[1].mute).toBe(true);
  expect(document.body.textContent).toContain('explicitly included');
  act(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Select currently audible tracks')!
      .click(),
  );
  expect(checkbox('demo').checked).toBe(false);
});

it('applies an exact range without enabling looping or changing recording targets', () => {
  const project = practice('Range');
  project.tracks = [track('take')];
  project.selection = { start: 0, end: 4 };
  project.loop = false;
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() => choose('End bar', '0'));
  const inputs = document.querySelectorAll<HTMLInputElement>('input');
  act(() => {
    fill(inputs[0], '2.125');
    fill(inputs[1], '4.75');
  });
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).toHaveBeenCalledWith({ start: 1.125, end: 3.75, trackId: 'take' });
  expect(project.loop).toBe(false);
  expect(project.selection).toEqual({ start: 0, end: 4 });
});

it('keeps the current range when a typed range is invalid', () => {
  const project = practice('Range');
  project.tracks = [track('take')];
  project.selection = { start: 0, end: 4 };
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() => fill(document.querySelectorAll<HTMLInputElement>('input')[0], '5'));
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[role=alert]')).not.toBeNull();
});

it('bounds typed ranges to the selected region and can restore the whole region', () => {
  const project = practice('Take range');
  project.tracks = [track('take')];
  project.tracks[0].offset = 0.5;
  project.selection = { start: 1, end: 2, trackId: 'take', clipId: 'clip' };
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() => choose('End bar', '1'));
  act(() => fill(document.querySelectorAll<HTMLInputElement>('input')[1], '2'));
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[role=alert]')!.textContent).toContain('within this region');
  act(() =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === 'Select whole region')!
      .click(),
  );
  expect(onSelect).toHaveBeenLastCalledWith({
    start: 0.5,
    end: 4.5,
    trackId: 'take',
    clipId: 'clip',
  });
});

it('creates a typed range without a drag gesture or arming a different recording track', () => {
  const project = practice('Range');
  project.tracks = [track('take')];
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() => choose('End bar', '0'));
  act(() => {
    fill(document.querySelectorAll<HTMLInputElement>('input')[0], '2');
    fill(document.querySelectorAll<HTMLInputElement>('input')[1], '3.5');
  });
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).toHaveBeenCalledWith({ start: 1, end: 2.5, trackId: 'take' });
  expect(project.selection).toBeNull();
});

it('refreshes range defaults and track selection when changing projects', () => {
  const first = practice('First');
  first.tracks = [track('old')];
  const next = practice('Next');
  next.tracks = [track('new', { clips: [{ ...track('new').clips[0], end: 8 }] })];
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={first}
        locale="en"
        trackId="old"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() => fill(document.querySelectorAll<HTMLInputElement>('input')[0], '2'));
  act(() =>
    root.render(
      <SelectionEditor
        project={next}
        locale="en"
        trackId="new"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  expect(document.querySelector<HTMLInputElement>('[aria-label="Start beat"]')!.value).toBe('1');
  expect(document.querySelector<HTMLSelectElement>('[aria-label="End bar"]')!.value).toBe('end');
  expect(document.querySelector('select')!.value).toBe('new');
  expect(onSelect).not.toHaveBeenCalled();
});

it('labels variable meters and the exclusive score end without inventing extra beats', () => {
  const score = {
    totalQ: 7.5,
    measures: [{ beatType: 4 }, { beatType: 4 }, { beatType: 8 }],
    route: [
      { number: '1', measure: 0, q: 0, duration: 4, pass: 1 },
      { number: '2', measure: 1, q: 4, duration: 2, pass: 1 },
      { number: '3', measure: 2, q: 6, duration: 1.5, pass: 1 },
    ],
  } as Score;
  expect(scorePositionLabel(5.5, score)).toBe('2.2+0.5');
  expect(scorePositionLabel(6, score)).toBe('3.1');
  expect(scorePositionLabel(7, score)).toBe('3.3');
  expect(scorePositionLabel(7.5, score)).toBe('End');
});

it('edits score ranges in bars and beats through tempo, alignment and beat-unit changes', () => {
  const project = newProject('Musical range');
  project.tracks = [track('take')];
  project.score = changingMeter;
  project.scoreMap = changingMap;
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  expect(document.querySelector('[aria-label="Start bar"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('Start (seconds)');
  act(() => {
    choose('Start bar', '1');
    choose('End bar', '2');
  });
  act(() => {
    fill(document.querySelector('[aria-label="Start beat"]')!, '1.5');
    fill(document.querySelector('[aria-label="End beat"]')!, '2');
  });
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).toHaveBeenCalledWith({ start: 5, end: 8.5, trackId: 'take' });
  expect(project.loop).toBe(false);
});

it('rejects a nonexistent beat rather than spilling into the next bar', () => {
  const project = newProject('Meter bounds');
  project.tracks = [track('take')];
  project.score = changingMeter;
  project.scoreMap = changingMap;
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() => choose('Start bar', '1'));
  act(() => fill(document.querySelector('[aria-label="Start beat"]')!, '3'));
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[role=alert]')!.textContent).toContain('valid beat');
});

it('preserves unedited sample-accurate endpoints despite rounded beat displays', () => {
  const project = newProject('Exact edges');
  project.tracks = [track('take')];
  project.score = changingMeter;
  project.scoreMap = changingMap;
  project.selection = { start: 5.6123456789, end: 9.123456789, trackId: 'take' };
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={onSelect}
      />,
    ),
  );
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onSelect).toHaveBeenCalledWith(project.selection);
});

it('distinguishes repeated printed bar numbers, pickup lengths and score boundaries', () => {
  const score = {
      totalQ: 6,
      measures: [{ beatType: 4 }, { beatType: 4 }],
      route: [
        { number: '0', measure: 0, q: 0, duration: 1, pass: 1 },
        { number: '1', measure: 1, q: 1, duration: 4, pass: 1 },
        { number: '0', measure: 0, q: 5, duration: 1, pass: 2 },
      ],
    } as Score,
    map = [
      { q: 0, seconds: 0.5 },
      { q: 6, seconds: 3.5 },
    ];
  expect(musicalPositionSeconds({ location: '2', value: '1' }, score, map)).toBe(3);
  expect(musicalPositionSeconds({ location: '0', value: '2' }, score, map)).toBeNaN();
  expect(musicalPositionAt(0, score, map)).toMatchObject({ location: 'before', value: '1' });
  expect(musicalPositionAt(4, score, map)).toMatchObject({ location: 'after', value: '1' });
  expect(musicalPositionSeconds({ location: 'end', value: '0' }, score, map)).toBe(3.5);
  expect(musicalPositionSeconds({ location: 'before', value: '.25' }, score, map)).toBe(0.375);
  expect(musicalPositionSeconds({ location: 'after', value: '.25' }, score, map)).toBe(3.625);
});

it('does not offer seconds-based practice without a score', () => {
  const project = newProject('Needs score');
  project.tracks = [track('take')];
  act(() =>
    root.render(
      <SelectionEditor
        project={project}
        locale="en"
        trackId="take"
        disabled={false}
        onSelect={() => {}}
      />,
    ),
  );
  expect(document.querySelector('input')).toBeNull();
  expect(document.body.textContent).toContain('Add a score');
});
