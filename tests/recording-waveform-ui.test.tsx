// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Timeline } from '../src/components/Timeline';
import { LiveWaveform } from '../src/lib/live-waveform';
import { newProject } from '../src/lib/storage';
import type { RecordingSession, Track } from '../src/lib/types';

let root: Root,
  nextFrame: number,
  frames: Map<number, FrameRequestCallback>,
  viewportWidth: number,
  scrollLeft: number;
const drawing = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: '',
  globalAlpha: 1,
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  frames = new Map();
  nextFrame = 0;
  viewportWidth = 800;
  scrollLeft = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    drawing as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const region = this.classList.contains('recording-region'),
      left = region ? 200 + parseFloat(this.style.left) - scrollLeft : 10,
      width = region ? parseFloat(this.style.width) : viewportWidth;
    return {
      left,
      right: left + width,
      width,
      height: 83,
      top: 0,
      bottom: 83,
      x: left,
      y: 0,
      toJSON() {},
    };
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  drawing.fillRect.mockClear();
  drawing.clearRect.mockClear();
  drawing.setTransform.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const target = (id: string): Track => ({
  id,
  name: id,
  role: id === 'Take' ? 'recording' : 'backing',
  clips: [],
  offset: 0,
  volume: 1,
  pan: 0,
  mute: false,
  solo: false,
  color: 0,
});
function buffer(count: number, sampleRate = 1000) {
  const waveform = new LiveWaveform();
  append(waveform, count, 0.2, sampleRate);
  return waveform;
}
function append(waveform: LiveWaveform, count: number, amplitude: number, sampleRate = 1000) {
  waveform.append({
    sampleRate,
    startFrame: waveform.frameCount,
    framesPerBin: 10,
    frames: new Uint32Array(count).fill(10),
    min: [new Float32Array(count).fill(-amplitude)],
    max: [new Float32Array(count).fill(amplitude)],
  });
}
function render(
  waveform: LiveWaveform,
  capture: Pick<RecordingSession, 'start'> &
    Partial<Pick<RecordingSession, 'speed' | 'latencyMs'>> = { start: 0 },
  options: {
    counting?: boolean;
    peak?: number;
    clipped?: boolean;
    scale?: number;
    position?: number;
  } = {},
) {
  const project = newProject('Live input');
  project.tracks = [target('Backing'), target('Take')];
  act(() =>
    root.render(
      <Timeline
        project={project}
        position={options.position ?? 1}
        locale="en"
        scale={options.scale ?? 100}
        snap={false}
        follow={false}
        waveforms={new Map()}
        recording
        playing
        counting={options.counting ?? false}
        locked
        activeRecording={{ trackId: 'Take', ...capture }}
        liveWaveform={waveform}
        inputPeak={options.peak ?? 0.25}
        inputClipped={options.clipped ?? false}
        onArm={() => {}}
        onSeek={() => {}}
        onSelect={() => {}}
        onTrack={() => {}}
        onTrim={() => {}}
        onContext={() => {}}
        onFollow={() => {}}
        onTrackSettings={() => {}}
      />,
    ),
  );
  Object.defineProperty(document.querySelector('.timeline-scroll'), 'clientWidth', {
    configurable: true,
    get: () => viewportWidth,
  });
}
function paint(now: number) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  });
}
const region = () => document.querySelector<HTMLElement>('.recording-region')!;
const canvas = () => document.querySelector<HTMLCanvasElement>('.recording-waveform')!;

it('shows current input dBFS and a clipped indicator on the recording target only', () => {
  render(buffer(10), { start: 0 }, { peak: 0.25, clipped: true });
  const row = document.querySelector('[data-track-id="Take"]')!,
    other = document.querySelector('[data-track-id="Backing"]')!;
  expect(row.querySelector('meter')?.getAttribute('value')).toBeCloseTo(-12.0412, 3);
  expect(row.querySelector('output')?.textContent).toBe('-12.0 dBFS');
  expect(row.querySelector('[role="status"]')?.textContent).toBe('Input clipped');
  expect(other.querySelector('meter')).toBeNull();
  render(buffer(10), { start: 0 }, { peak: 0 });
  expect(document.querySelector('.recording-level output')?.textContent).toBe('−∞ dBFS');
  expect(document.querySelector('.recording-level meter')?.getAttribute('value')).toBe('-60');
});

it('grows and redraws from captured samples before recording stops', () => {
  const waveform = buffer(20);
  render(waveform);
  paint(100);
  expect(region().style.width).toBe('20px');
  expect(canvas().dataset.recordedFrames).toBe('200');
  const initialHeights = drawing.fillRect.mock.calls.map((call) => Number(call[3]));
  append(waveform, 30, 0.8);
  render(waveform, { start: 0 }, { position: 0.5 });
  drawing.fillRect.mockClear();
  paint(140);
  expect(region().style.width).toBe('50px');
  expect(canvas().dataset.recordedFrames).toBe('500');
  expect(canvas().dataset.binCount).toBe('50');
  expect(Math.max(...drawing.fillRect.mock.calls.map((call) => Number(call[3])))).toBeGreaterThan(
    Math.max(...initialHeights) * 2,
  );
  expect(region().textContent).toContain('Recording');
});

it('uses captured duration rather than transport position and honors practice speed and compensation', () => {
  const waveform = buffer(100);
  render(waveform, { start: 12, speed: 0.75, latencyMs: 80 }, { position: 50 });
  expect(parseFloat(region().style.left)).toBeCloseTo(1194);
  expect(parseFloat(region().style.width)).toBeCloseTo(75);
  render(waveform, { start: 0, speed: 0.75, latencyMs: 80 });
  expect(region().style.left).toBe('0px');
  expect(parseFloat(region().style.width)).toBeCloseTo(69);
});

it('keeps an empty count-in flat and does not invent waveform data from the input meter', () => {
  render(new LiveWaveform(), { start: 3 }, { counting: true, peak: 0.9, position: 10 });
  paint(100);
  expect(region().textContent).toContain('Count-in');
  expect(region().style.width).toBe('4px');
  expect(canvas().dataset.recordedFrames).toBe('0');
  expect(drawing.fillRect).not.toHaveBeenCalled();
});

it('draws separate channel envelopes from the selected-channel telemetry', () => {
  const waveform = new LiveWaveform();
  waveform.append({
    startFrame: 0,
    sampleRate: 1000,
    framesPerBin: 10,
    frames: Uint32Array.from([10]),
    min: [Float32Array.from([-0.1]), Float32Array.from([-0.8])],
    max: [Float32Array.from([0.1]), Float32Array.from([0.8])],
  });
  render(waveform);
  paint(100);
  const strokes = drawing.fillRect.mock.calls.filter((call) => Number(call[3]) > 1);
  expect(strokes).toHaveLength(2);
  expect(Number(strokes[1][3])).toBeGreaterThan(Number(strokes[0][3]) * 5);
  expect(Number(strokes[1][1])).toBeGreaterThan(Number(strokes[0][1]));
});

it('keeps a scrolled long recording canvas inside the visible lane and cancels its animation on unmount', () => {
  const waveform = buffer(90000);
  viewportWidth = 800;
  scrollLeft = 50000;
  render(waveform, { start: 0 }, { position: 900 });
  paint(100);
  expect(canvas().width).toBeLessThanOrEqual(610 * 2);
  expect(parseFloat(canvas().style.left)).toBe(50000);
  expect(parseFloat(canvas().style.width)).toBe(610);
  expect(drawing.fillRect).toHaveBeenCalled();
  act(() => root.render(null));
  expect(frames.size).toBe(0);
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

it('bounds zoomed-out drawing by visible pixels while preserving a short impulse among silent bins', () => {
  const waveform = new LiveWaveform(),
    minimum = new Float32Array(90000),
    maximum = new Float32Array(90000);
  minimum[25] = -0.9;
  maximum[25] = 0.9;
  waveform.append({
    startFrame: 0,
    sampleRate: 1000,
    framesPerBin: 10,
    frames: new Uint32Array(90000).fill(10),
    min: [minimum],
    max: [maximum],
  });
  render(waveform, { start: 0 }, { scale: 1, position: 900 });
  paint(100);
  expect(parseFloat(canvas().style.width)).toBe(610);
  expect(drawing.fillRect.mock.calls.length).toBeLessThanOrEqual(611);
  expect(Math.max(...drawing.fillRect.mock.calls.map((call) => Number(call[3])))).toBeGreaterThan(
    40,
  );
  expect(drawing.fillRect.mock.calls.some((call) => call[0] === 0 && Number(call[3]) > 40)).toBe(
    true,
  );

  const silence = new LiveWaveform();
  silence.append({
    startFrame: 0,
    sampleRate: 1000,
    framesPerBin: 10,
    frames: new Uint32Array(90000).fill(10),
    min: [new Float32Array(90000)],
    max: [new Float32Array(90000)],
  });
  render(silence, { start: 0 }, { scale: 1, position: 900 });
  drawing.fillRect.mockClear();
  paint(140);
  expect(drawing.fillRect.mock.calls.length).toBeLessThanOrEqual(611);
  expect(Math.max(...drawing.fillRect.mock.calls.map((call) => Number(call[3])))).toBe(1);
});
