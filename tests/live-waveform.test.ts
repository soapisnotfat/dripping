import { expect, it } from 'vitest';
import {
  LiveWaveform,
  recordingFrameTime,
  recordingWaveformBounds,
} from '../src/lib/live-waveform';
import type { RecordingWaveformPacket } from '../src/lib/recording-waveform';

function packet(
  startFrame: number,
  lows: number[][],
  highs: number[][],
  frames = Array.from({ length: lows[0].length }, () => 10),
): RecordingWaveformPacket {
  return {
    startFrame,
    sampleRate: 1000,
    framesPerBin: 10,
    frames: Uint32Array.from(frames),
    min: lows.map((values) => Float32Array.from(values)),
    max: highs.map((values) => Float32Array.from(values)),
  };
}

it('accumulates channel-specific min/max without copying the full envelope on each packet', () => {
  const waveform = new LiveWaveform();
  expect(
    waveform.append(
      packet(
        0,
        [
          [-0.2, -0.4],
          [-0.8, -0.1],
        ],
        [
          [0.3, 0.6],
          [0.9, 0.2],
        ],
      ),
    ),
  ).toBe(true);
  const original = waveform.min[0];
  expect(waveform.append(packet(20, [[-0.5], [-0.7]], [[0.8], [1.1]]))).toBe(true);
  expect(waveform.min[0]).toBe(original);
  expect(waveform.sampleRate).toBe(1000);
  expect(waveform.channelCount).toBe(2);
  expect(waveform.frameCount).toBe(30);
  expect(waveform.binCount).toBe(3);
  expect(waveform.binFrames).toBe(10);
  expect(Array.from(waveform.min[0].subarray(0, 3))).toEqual([
    expect.closeTo(-0.2),
    expect.closeTo(-0.4),
    expect.closeTo(-0.5),
  ]);
  expect(waveform.max[1][2]).toBeCloseTo(1.1);
  expect(waveform.revision).toBe(2);
});

it('preserves true silence and one-sided envelopes, including a partial final bin', () => {
  const waveform = new LiveWaveform();
  waveform.append(packet(0, [[0, 0.2]], [[0, 0.8]], [10, 3]));
  expect(waveform.frameCount).toBe(13);
  expect(waveform.binCount).toBe(2);
  expect(Array.from(waveform.min[0].subarray(0, 2))).toEqual([0, expect.closeTo(0.2)]);
  expect(Array.from(waveform.max[0].subarray(0, 2))).toEqual([0, expect.closeTo(0.8)]);
  expect(recordingWaveformBounds({ start: 2 }, waveform)).toMatchObject({ start: 2, end: 2.013 });
});

it('keeps the complete duration and extrema in bounded memory through repeated compaction', () => {
  const waveform = new LiveWaveform(4),
    add = (start: number, count: number) =>
      waveform.append(
        packet(
          start * 10,
          [Array.from({ length: count }, (_, i) => -(start + i))],
          [Array.from({ length: count }, (_, i) => start + i + 1)],
        ),
      );
  add(0, 4);
  add(4, 4);
  add(8, 8);
  expect(waveform.frameCount).toBe(160);
  expect(waveform.binCount).toBe(4);
  expect(waveform.binFrames).toBe(40);
  expect(waveform.min[0].length).toBeLessThanOrEqual(4);
  expect(waveform.max[0].length).toBeLessThanOrEqual(4);
  expect(Array.from(waveform.min[0].subarray(0, 4))).toEqual([-3, -7, -11, -15]);
  expect(Array.from(waveform.max[0].subarray(0, 4))).toEqual([4, 8, 12, 16]);
  expect(recordingFrameTime({ start: 7 }, waveform, waveform.frameCount)).toBeCloseTo(7.16);
});

it('merges an incomplete last display bin with subsequent data without shifting its time axis', () => {
  const waveform = new LiveWaveform(3);
  waveform.append(packet(0, [[-0.1, -0.2, -0.3]], [[0.1, 0.2, 0.3]]));
  waveform.append(packet(30, [[-0.9]], [[0.9]], [4]));
  expect(waveform.binFrames).toBe(20);
  expect(waveform.frameCount).toBe(34);
  expect(waveform.binCount).toBe(2);
  expect(waveform.min[0][1]).toBeCloseTo(-0.9);
  expect(waveform.max[0][1]).toBeCloseTo(0.9);
});

it('rejects gaps, stale packets and incompatible formats before changing the display', () => {
  const waveform = new LiveWaveform();
  waveform.append(packet(0, [[-0.3]], [[0.4]]));
  const revision = waveform.revision;
  expect(waveform.append(packet(0, [[-1]], [[1]]))).toBe(false);
  expect(waveform.append(packet(20, [[-1]], [[1]]))).toBe(false);
  expect(waveform.append({ ...packet(10, [[-1]], [[1]]), sampleRate: 2000 })).toBe(false);
  expect(waveform.append(packet(10, [[-1], [-1]], [[1], [1]]))).toBe(false);
  expect(waveform.append(packet(10, [[0.5]], [[0.1]]))).toBe(false);
  expect(waveform.append(packet(10, [[NaN]], [[1]]))).toBe(false);
  expect(waveform.frameCount).toBe(10);
  expect(waveform.revision).toBe(revision);
  expect(waveform.min[0][0]).toBeCloseTo(-0.3);
});

it('maps practice speed and correction onto the project clock at a nonzero start', () => {
  const session = { start: 12, speed: 0.75, latencyMs: 80 },
    waveform = { sampleRate: 48000, frameCount: 96000 };
  expect(recordingFrameTime(session, waveform, 0)).toBeCloseTo(11.94);
  expect(recordingFrameTime(session, waveform, 24000)).toBeCloseTo(12.315);
  expect(recordingWaveformBounds(session, waveform)).toMatchObject({
    rawStart: expect.closeTo(11.94),
    start: expect.closeTo(11.94),
    end: expect.closeTo(13.44),
    sourceStart: 0,
  });
});

it('clips the project-zero boundary without stretching or discarding the original source coordinates', () => {
  const session = { start: 0, speed: 0.75, latencyMs: 80 },
    waveform = { sampleRate: 48000, frameCount: 48000 },
    bounds = recordingWaveformBounds(session, waveform);
  expect(bounds.rawStart).toBeCloseTo(-0.06);
  expect(bounds.start).toBe(0);
  expect(bounds.end).toBeCloseTo(0.69);
  expect(bounds.sourceStart).toBeCloseTo(0.08);
  expect(
    recordingFrameTime(session, waveform, bounds.sourceStart * waveform.sampleRate),
  ).toBeCloseTo(0);
});
