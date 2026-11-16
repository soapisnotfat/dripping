import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worklet(channels: number[], sampleRate = 48000) {
  const messages: any[] = [];
  let Processor: any;
  const scope: any = {
    currentFrame: 0,
    sampleRate,
    Float32Array,
    Uint32Array,
    registerProcessor: (_name: string, value: any) => {
      Processor = value;
    },
    AudioWorkletProcessor: class {
      port = { onmessage: null, postMessage: (message: any) => messages.push(message) };
    },
  };
  runInNewContext(
    readFileSync(new URL('../src/workers/recorder.worklet.js', import.meta.url), 'utf8'),
    scope,
  );
  return { processor: new Processor({ processorOptions: { channels } }), messages, scope };
}

it('meters the selected channel before recording without saving or monitoring input', () => {
  const { processor, messages } = worklet([1]);
  const output = new Float32Array(128).fill(1);
  processor.process(
    [[new Float32Array(128).fill(0.9), new Float32Array(128).fill(0.2)]],
    [[output]],
  );
  expect(messages.find((m) => m.type === 'meter').peaks[0]).toBeCloseTo(0.2, 6);
  expect(messages.some((m) => m.type === 'chunk')).toBe(false);
  expect(output.every((value) => value === 0)).toBe(true);
});

it('reports both stereo channels and clears the meter when the signal stops', () => {
  const { processor, messages, scope } = worklet([0, 1]);
  processor.process([[new Float32Array(128).fill(0.3), new Float32Array(128).fill(0.7)]], [[]]);
  expect(Array.from(messages[0].peaks)).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0.7, 6)]);
  scope.currentFrame = 128 * 12;
  processor.process([[new Float32Array(128), new Float32Array(128)]], [[]]);
  expect(messages.at(-1)).toMatchObject({ type: 'meter', peak: 0, peaks: [0, 0] });
});

it('rejects an unavailable input channel during the level check', () => {
  const { processor, messages } = worklet([1]);
  processor.process([[new Float32Array(128)]], [[]]);
  expect(
    messages.some(
      (m) => m.type === 'error' && m.message.includes('Selected input channel unavailable'),
    ),
  ).toBe(true);
  expect(messages.some((m) => m.type === 'chunk')).toBe(false);
});

it('retains an overload between meter updates instead of missing a short peak', () => {
  const { processor, messages, scope } = worklet([0]);
  processor.process([[new Float32Array(128)]], [[]]);
  scope.currentFrame = 128;
  const impulse = new Float32Array(128);
  impulse[64] = 1;
  processor.process([[impulse]], [[]]);
  scope.currentFrame = 128 * 12;
  processor.process([[new Float32Array(128)]], [[]]);
  expect(messages.at(-1)).toMatchObject({ type: 'meter', peak: 1, clipped: true });
});

it('still captures only the armed interval and selected channel', () => {
  const { processor, messages } = worklet([1]);
  processor.port.onmessage({ data: { type: 'arm', startFrame: 10, endFrame: 20 } });
  processor.process(
    [[new Float32Array(128).fill(0.8), Float32Array.from({ length: 128 }, (_, i) => i / 128)]],
    [[]],
  );
  const chunk = messages.find((m) => m.type === 'chunk');
  expect(Array.from(chunk.data[0])).toEqual(Array.from({ length: 10 }, (_, i) => (i + 10) / 128));
  expect(messages.at(-1).type).toBe('done');
});

function renderFrames(
  fixture: ReturnType<typeof worklet>,
  total: number,
  input: (frame: number, channel: number) => number,
  channelCount = 2,
) {
  for (let start = fixture.scope.currentFrame; start < total; start += 128) {
    fixture.scope.currentFrame = start;
    fixture.processor.process(
      [
        Array.from({ length: channelCount }, (_, channel) =>
          Float32Array.from({ length: 128 }, (_, index) => input(start + index, channel)),
        ),
      ],
      [[]],
    );
  }
  fixture.scope.currentFrame = Math.ceil(total / 128) * 128;
}

it('sends selected-channel min/max envelopes before a persistent PCM chunk is ready', () => {
  const fixture = worklet([1]);
  fixture.processor.port.onmessage({ data: { type: 'arm', startFrame: 0, endFrame: Infinity } });
  renderFrames(fixture, 1920, (frame, channel) => (channel === 0 ? 0.9 : frame % 2 ? -0.5 : 0.25));
  expect(fixture.messages.some((message) => message.type === 'chunk')).toBe(false);
  const packets = fixture.messages.filter((message) => message.type === 'waveform');
  expect(packets).toHaveLength(1);
  expect(packets[0]).toMatchObject({ sampleRate: 48000, startFrame: 0, framesPerBin: 480 });
  expect(Array.from(packets[0].frames)).toEqual([480, 480, 480, 480]);
  expect(packets[0].min).toHaveLength(1);
  expect(Array.from(packets[0].min[0])).toEqual([-0.5, -0.5, -0.5, -0.5]);
  expect(Array.from(packets[0].max[0])).toEqual([0.25, 0.25, 0.25, 0.25]);
});

it('reduces envelope batches at high sample rates instead of waiting for raw PCM storage', () => {
  const fixture = worklet([0], 192000);
  fixture.processor.port.onmessage({ data: { type: 'arm', startFrame: 0, endFrame: Infinity } });
  renderFrames(fixture, 3840, () => 0.1, 1);
  expect(fixture.messages.some((message) => message.type === 'chunk')).toBe(false);
  const packet = fixture.messages.find((message) => message.type === 'waveform');
  expect(packet).toMatchObject({ sampleRate: 192000, framesPerBin: 1920, startFrame: 0 });
  expect(Array.from(packet.frames)).toEqual([1920, 1920]);
});

it('does not publish waveform samples during level checks or before the capture start', () => {
  const fixture = worklet([0]);
  renderFrames(fixture, 2048, () => 0.9, 1);
  expect(fixture.messages.some((message) => message.type === 'waveform')).toBe(false);
  fixture.processor.port.onmessage({ data: { type: 'arm', startFrame: 4000, endFrame: 5025 } });
  renderFrames(fixture, 5120, (frame) => (frame < 4000 ? 0.9 : 0.2), 1);
  const packets = fixture.messages.filter((message) => message.type === 'waveform');
  expect(packets).toHaveLength(1);
  expect(packets[0].startFrame).toBe(0);
  expect(Array.from(packets[0].frames)).toEqual([480, 480, 65]);
  expect(Array.from(packets[0].max[0])).toEqual([
    expect.closeTo(0.2, 6),
    expect.closeTo(0.2, 6),
    expect.closeTo(0.2, 6),
  ]);
});

it('flushes a partial silence bin on manual stop with exact captured-frame counts', () => {
  const fixture = worklet([0, 1]);
  fixture.processor.port.onmessage({ data: { type: 'arm', startFrame: 0, endFrame: Infinity } });
  renderFrames(fixture, 512, () => 0);
  expect(fixture.messages.some((message) => message.type === 'waveform')).toBe(false);
  fixture.processor.port.onmessage({ data: { type: 'stop' } });
  const packets = fixture.messages.filter((message) => message.type === 'waveform');
  expect(packets).toHaveLength(1);
  expect(Array.from(packets[0].frames)).toEqual([480, 32]);
  expect(packets[0].min.map((values: Float32Array) => Array.from(values))).toEqual([
    [0, 0],
    [0, 0],
  ]);
  expect(packets[0].max.map((values: Float32Array) => Array.from(values))).toEqual([
    [0, 0],
    [0, 0],
  ]);
  expect(fixture.messages.find((message) => message.type === 'chunk').data[0]).toHaveLength(512);
  expect(fixture.messages.at(-1).type).toBe('done');
});

it('keeps stereo waveform packets contiguous while preserving raw recording chunks exactly', () => {
  const fixture = worklet([1, 0]),
    value = (frame: number, channel: number) =>
      Math.fround((channel ? -0.6 : 0.3) * Math.sin(frame / 7));
  fixture.processor.port.onmessage({ data: { type: 'arm', startFrame: 17, endFrame: 4338 } });
  renderFrames(fixture, 4352, value);
  const packets = fixture.messages.filter((message) => message.type === 'waveform');
  expect(packets.map((packet) => packet.startFrame)).toEqual([0, 1920, 3840]);
  expect(Array.from(packets[2].frames)).toEqual([480, 1]);
  expect(
    packets.reduce(
      (sum, packet) => sum + Array.from<number>(packet.frames).reduce((a, b) => a + b, 0),
      0,
    ),
  ).toBe(4321);
  const chunks = fixture.messages.filter((message) => message.type === 'chunk');
  expect(chunks.map((chunk) => chunk.data[0].length)).toEqual([4096, 225]);
  for (const [index, channel] of [1, 0].entries()) {
    const captured = chunks.flatMap((chunk) => Array.from(chunk.data[index]));
    expect(captured).toEqual(Array.from({ length: 4321 }, (_, i) => value(i + 17, channel)));
    for (const packet of packets) {
      let start = 17 + packet.startFrame;
      for (const [bin, frames] of Array.from<number>(packet.frames).entries()) {
        const samples = Array.from({ length: frames }, (_, i) => value(start + i, channel));
        expect(packet.min[index][bin]).toBe(Math.min(...samples));
        expect(packet.max[index][bin]).toBe(Math.max(...samples));
        start += frames;
      }
    }
  }
  const packetCount = packets.length;
  fixture.scope.currentFrame = 4352;
  fixture.processor.process([[new Float32Array(128), new Float32Array(128)]], [[]]);
  expect(fixture.messages.filter((message) => message.type === 'waveform')).toHaveLength(
    packetCount,
  );
});
