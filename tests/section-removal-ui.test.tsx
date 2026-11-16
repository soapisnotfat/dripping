// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { newProject } from '../src/lib/storage';
import { parseScore } from '../src/lib/score';
import { tempoMap } from '../src/lib/time';
import { clipSelection } from '../src/lib/timeline';
import type { Project, Track } from '../src/lib/types';

const state = vi.hoisted(() => ({ project: null as Project | null }));
vi.mock('../src/lib/storage', async (original) => ({
  ...(await original<typeof import('../src/lib/storage')>()),
  listProjects: async () => [],
  recoverySessions: async () => [],
  getProject: async () => structuredClone(state.project),
  saveProject: vi.fn(async () => {}),
}));
vi.mock('../src/lib/transport', () => ({
  transport: {
    reset: vi.fn(),
    seek: vi.fn(),
    pause: vi.fn(() => 0),
    updateMix: vi.fn(),
    asset: async () => ({ sampleRate: 8000, channels: [new Float32Array(8)] }),
  },
}));
vi.mock('../src/components/ScoreView', () => ({ ScoreView: () => null }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Element.prototype.scrollTo = vi.fn();
  localStorage.clear();
  localStorage.setItem('dripping.locale', 'en');
  localStorage.setItem('dripping.lastProject', 'fixture');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(partial = false) {
  const project = newProject('Delete UI'),
    track: Track = {
      id: 'take',
      name: 'Take',
      role: 'recording',
      offset: 0.5,
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      color: 0,
      clips: ['First', 'Second'].map((id, i) => ({
        id,
        label: id,
        assetId: id,
        start: i * 4,
        end: (i + 1) * 4,
        sourceStart: 0,
        rate: 1,
        gain: 1,
        fadeIn: 0,
        fadeOut: 0,
      })),
    };
  project.score = parseScore(
    '<score-partwise><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="60"/></direction><note><rest/><duration>4</duration></note></measure><measure number="2"><note><rest/><duration>4</duration></note></measure><measure number="3"><note><rest/><duration>4</duration></note></measure></part></score-partwise>',
  );
  project.scoreMap = tempoMap(project.score);
  project.tracks = [track];
  project.selection = partial
    ? { start: 1.5, end: 2.5, trackId: 'take', clipId: 'First' }
    : clipSelection(track, track.clips[0]);
  state.project = project;
  await act(async () => root.render(<App />));
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label)!;
const clips = () =>
  [...document.querySelectorAll<HTMLElement>('[data-clip-id]')].map((c) => c.dataset.clipId);
const key = (value: string, target: EventTarget = document.body) =>
  act(() =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );

it('shows an explicit whole-region delete button and restores the region using Undo', async () => {
  await render();
  expect(button('Delete region').disabled).toBe(false);
  act(() => button('Delete region').click());
  expect(clips()).toEqual(['Second']);
  const undo = document.querySelector<HTMLButtonElement>('[title="Undo · Delete selected audio"]')!;
  expect(undo).not.toBeNull();
  act(() => undo.click());
  expect(clips()).toEqual(['First', 'Second']);
});

it.each(['Delete', 'Backspace'])('removes the selected region with %s', async (value) => {
  await render();
  key(value);
  expect(clips()).toEqual(['Second']);
  key(value);
  expect(clips()).toEqual(['Second']);
});

it('labels range deletion separately and removes only that part of the region', async () => {
  await render(true);
  act(() => button('Delete selected audio').click());
  expect(clips()).toEqual(['Firsta', 'Firstbb', 'Second']);
});

it('allows deleting a selected region while its trim handle has keyboard focus', async () => {
  await render();
  const handle = document.querySelector<HTMLElement>('.trim-start')!;
  act(() => handle.focus());
  key('Delete', handle);
  expect(clips()).toEqual(['Second']);
});

it('does not delete audio when editing a text field or while a dialog is open', async () => {
  await render();
  key('Backspace', document.querySelector('input')!);
  expect(clips()).toEqual(['First', 'Second']);
  act(() => document.querySelector<HTMLButtonElement>('[title="Track settings"]')!.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  key('Delete');
  expect(clips()).toEqual(['First', 'Second']);
});

it('clears looping and seeks to the exact waveform point after a whole-region selection', async () => {
  await render();
  const lane = document.querySelector<HTMLElement>('.track-lane')!;
  lane.setPointerCapture = vi.fn();
  lane.hasPointerCapture = () => false;
  vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 0 } as DOMRect);
  act(() => lane.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 42 })));
  const loop = document.querySelector<HTMLButtonElement>('[aria-label="Loop selection"]')!;
  act(() => loop.click());
  expect(loop.getAttribute('aria-pressed')).toBe('true');
  for (const type of ['pointerdown', 'pointerup']) {
    act(() =>
      lane.dispatchEvent(
        new MouseEvent(type, { bubbles: true, button: 0, clientX: 2.123 * 42, altKey: true }),
      ),
    );
  }
  expect(document.querySelector('[aria-pressed="true"][data-clip-id]')).toBeNull();
  expect(loop.getAttribute('aria-pressed')).toBe('false');
  expect(loop.disabled).toBe(true);
  expect(
    parseFloat(document.querySelector<HTMLElement>('.timeline-playhead')!.style.left),
  ).toBeCloseTo(190 + 2.123 * 42, 6);
});
