import { expect, it } from 'vitest';
import { encodeWav } from '../src/lib/audio';
import { amplitudeDb, measureExport, masterWav, planMaster } from '../src/lib/master';
import type { PCM } from '../src/lib/types';

const rate = 48000;
const tone = (frequency: number, amplitude = 0.1, seconds = 2, phase = 0) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate + phase),
  );
const pcm = (...channels: Float32Array[]): PCM => ({ sampleRate: rate, channels });
function decode24(buffer: ArrayBuffer): PCM {
  const view = new DataView(buffer),
    channels = view.getUint16(22, true),
    frames = view.getUint32(40, true) / (3 * channels),
    out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const at = 44 + (i * channels + c) * 3,
        n = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
      out[c][i] = n / (n < 0 ? 8388608 : 8388607);
    }
  return { sampleRate: view.getUint32(24, true), channels: out };
}
it('writes interleaved PCM24 without losing low-level detail or changing source samples', () => {
  const original = pcm(
      new Float32Array([-0.9, -0.00001, 0, 0.00001, 0.9]),
      new Float32Array([0.8, 0.00002, 0, -0.00002, -0.8]),
    ),
    copy = original.channels.map((channel) => channel.slice());
  const wav = encodeWav(original, 24),
    view = new DataView(wav),
    decoded = decode24(wav);
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(34, true)).toBe(24);
  expect(view.getUint32(28, true)).toBe(rate * 2 * 3);
  expect(wav.byteLength).toBe(44 + 5 * 2 * 3);
  decoded.channels.forEach((channel, c) =>
    channel.forEach((value, i) =>
      expect(Math.abs(value - original.channels[c][i])).toBeLessThan(1 / 8388607),
    ),
  );
  expect(original.channels).toEqual(copy);
});
it('measures BS.1770 loudness without stereo phase cancellation and gates quiet passages', () => {
  const mono = measureExport(pcm(tone(1000))),
    stereo = measureExport(pcm(tone(1000), tone(1000, 0.1, 2, Math.PI)));
  expect(mono.lufs).toBeCloseTo(-23, 1);
  expect(stereo.lufs! - mono.lufs!).toBeCloseTo(3.0103, 2);
  const dynamic = new Float32Array(rate * 4);
  dynamic.set(tone(1000));
  dynamic.set(tone(1000, 0.0001), rate * 2);
  expect(measureExport(pcm(dynamic)).lufs).toBeCloseTo(mono.lufs!, 0);
  expect(measureExport(pcm(tone(1000, 0.1, 0.3))).lufs).toBeNull();
  expect(measureExport(pcm(new Float32Array(rate)))).toMatchObject({
    samplePeak: 0,
    truePeak: 0,
    lufs: null,
  });
});
it('finds intersample peaks and applies one gain without compressing dynamics or mutating PCM', () => {
  const source = pcm(tone(12000, 1.2, 1, Math.PI / 4)),
    before = source.channels[0].slice(),
    stats = measureExport(source);
  expect(stats.samplePeak).toBeLessThan(0.9);
  expect(stats.truePeak).toBeGreaterThan(1.15);
  const result = masterWav(source, stats, { gainDb: 6, ceilingDb: -1, targetLufs: -14 }, 24),
    decoded = decode24(result.wav),
    output = measureExport(decoded),
    gain = 10 ** (result.plan.gainDb / 20);
  expect(amplitudeDb(output.truePeak)).toBeLessThanOrEqual(-0.9999);
  for (let i = 0; i < before.length; i += 137)
    expect(Math.abs(decoded.channels[0][i] - before[i] * gain)).toBeLessThan(1.3e-7);
  expect(source.channels[0]).toEqual(before);
});
it('prioritizes peak headroom when the requested loudness cannot be reached', () => {
  const stats = { samplePeak: 0.95, truePeak: 1.05, rms: 0.05, lufs: -30 },
    plan = planMaster(stats, { gainDb: 0, ceilingDb: -1, targetLufs: -18 });
  expect(plan.targetLimited).toBe(true);
  expect(plan.lufs).toBeLessThan(-30);
  expect(amplitudeDb(plan.truePeak)).toBeCloseTo(-1.7, 3);
  expect(() => planMaster(stats, { gainDb: NaN, ceilingDb: -1 })).toThrow('Invalid output level');
});
