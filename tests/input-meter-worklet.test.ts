import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worklet(channels: number[]) {
  const messages: any[] = [];
  let Processor: any;
  const scope: any = {
    currentFrame: 0,
    Float32Array,
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
