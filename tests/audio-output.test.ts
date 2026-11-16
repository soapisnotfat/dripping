import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { Transport } from '../src/lib/transport';

afterEach(() => vi.unstubAllGlobals());

function audioContext() {
  const switchOutput = vi.fn<(deviceId: string) => Promise<void>>().mockResolvedValue(),
    created = vi.fn();
  class Context {
    sinkId = '';
    destination = {};
    constructor() {
      created();
    }
    createGain() {
      return { connect: vi.fn() };
    }
    createChannelSplitter() {
      return { connect: vi.fn() };
    }
    createAnalyser() {
      return { fftSize: 4096 };
    }
    async setSinkId(deviceId: string) {
      await switchOutput(deviceId);
      this.sinkId = deviceId;
    }
  }
  vi.stubGlobal('AudioContext', Context);
  return { switchOutput, created };
}

it('routes the existing audio graph to a chosen output and back to the system default', async () => {
  const { switchOutput, created } = audioContext(),
    transport = new Transport();
  expect(transport.supportsOutputSelection).toBe(true);
  await transport.setOutputDevice('');
  expect(created).not.toHaveBeenCalled();
  await transport.setOutputDevice('ae20-output');
  const context = transport.ctx;
  expect(transport.outputDeviceId).toBe('ae20-output');
  transport.playing = true;
  await transport.setOutputDevice('');
  expect(transport.outputDeviceId).toBe('');
  expect(transport.ctx).toBe(context);
  expect(transport.playing).toBe(true);
  expect(created).toHaveBeenCalledOnce();
  expect(switchOutput.mock.calls).toEqual([['ae20-output'], ['']]);
});

it('keeps system-default playback available when the browser cannot select an output', async () => {
  const created = vi.fn();
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        created();
      }
    },
  );
  const transport = new Transport();
  expect(transport.supportsOutputSelection).toBe(false);
  await expect(transport.setOutputDevice('')).resolves.toBeUndefined();
  await expect(transport.setOutputDevice('ae20-output')).rejects.toThrow(
    'Choose the output in system sound settings',
  );
  expect(transport.outputDeviceId).toBe('');
  expect(created).not.toHaveBeenCalled();
});

it('preserves the applied output on a failed switch and permits a later recovery', async () => {
  const { switchOutput } = audioContext(),
    transport = new Transport();
  await transport.setOutputDevice('ae20-output');
  switchOutput.mockRejectedValueOnce(
    new DOMException('Speaker selection denied', 'NotAllowedError'),
  );
  await expect(transport.setOutputDevice('speakers')).rejects.toThrow('Speaker selection denied');
  expect(transport.outputDeviceId).toBe('ae20-output');
  await transport.setOutputDevice('');
  expect(transport.outputDeviceId).toBe('');
});

it('applies overlapping device changes in request order so the final selection wins', async () => {
  const { switchOutput } = audioContext(),
    transport = new Transport();
  let finishFirst!: () => void;
  switchOutput.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finishFirst = resolve)),
  );
  const first = transport.setOutputDevice('ae20-output'),
    second = transport.setOutputDevice('speakers');
  await Promise.resolve();
  expect(switchOutput.mock.calls).toEqual([['ae20-output']]);
  finishFirst();
  await Promise.all([first, second]);
  expect(switchOutput.mock.calls).toEqual([['ae20-output'], ['speakers']]);
  expect(transport.outputDeviceId).toBe('speakers');
});
