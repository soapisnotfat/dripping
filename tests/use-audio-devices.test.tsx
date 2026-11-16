// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAudioDevices } from '../src/hooks/useAudioDevices';

const audio = vi.hoisted(() => ({
  supported: true,
  actualOutput: '',
  setOutputDevice: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('../src/lib/transport', () => ({
  transport: {
    get supportsOutputSelection() {
      return audio.supported;
    },
    get outputDeviceId() {
      return audio.actualOutput;
    },
    setOutputDevice: audio.setOutputDevice,
  },
}));

type Routing = ReturnType<typeof useAudioDevices>;
let root: Root, result: Routing, media: MediaDevices;
let listed: MediaDeviceInfo[];
let enumerate: ReturnType<typeof vi.fn<() => Promise<MediaDeviceInfo[]>>>;
let getUserMedia: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
const device = (
  kind: MediaDeviceKind,
  id: string,
  label: string,
  groupId = '',
): MediaDeviceInfo => ({ kind, deviceId: id, label, groupId, toJSON: () => ({}) });
const laptop = () => [
  device('audioinput', 'laptop-mic', 'Built-in microphone', 'laptop'),
  device('audiooutput', 'laptop-output', 'Built-in speakers', 'laptop'),
];
const instrument = () => [
  device('audioinput', 'ae20-in', 'AE-20', 'instrument'),
  device('audiooutput', 'ae20-out', 'AE-20', 'instrument'),
];
function Harness({ locked }: { locked: boolean }) {
  result = useAudioDevices({ locked });
  return <output>{JSON.stringify({ input: result.inputId, output: result.outputId })}</output>;
}
async function render(locked = false) {
  await act(async () => root.render(<Harness locked={locked} />));
}
async function changed() {
  await act(async () => media.dispatchEvent(new Event('devicechange')));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  audio.supported = true;
  audio.actualOutput = '';
  audio.setOutputDevice.mockReset();
  audio.setOutputDevice.mockImplementation(async (id) => {
    audio.actualOutput = id;
  });
  listed = laptop();
  enumerate = vi.fn(async () => listed);
  getUserMedia = vi.fn();
  media = Object.assign(new EventTarget(), {
    enumerateDevices: enumerate,
    getUserMedia,
  }) as unknown as MediaDevices;
  vi.stubGlobal('navigator', { mediaDevices: media });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('detects an inserted audio interface and applies its paired input/output without asking for access on load', async () => {
  await render();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(result.status).toBe('no-device');
  listed = [...laptop(), ...instrument()];
  await changed();
  expect(result.inputId).toBe('ae20-in');
  expect(result.outputId).toBe('ae20-out');
  expect(result.status).toBe('automatic');
  expect(localStorage.getItem('dripping.inputDevice')).toBe('ae20-in');
  expect(localStorage.getItem('dripping.outputDevice')).toBe('ae20-out');
});

it('respects manual choices across later plug events and across reload', async () => {
  listed = [...laptop(), ...instrument()];
  await render();
  await act(async () => {
    await result.selectInput('laptop-mic');
    await result.selectOutput('laptop-output');
  });
  expect(result.autoConnect).toBe(false);
  await changed();
  expect(result.inputId).toBe('laptop-mic');
  expect(result.outputId).toBe('laptop-output');
  act(() => root.unmount());
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  audio.actualOutput = '';
  await render();
  expect(result.autoConnect).toBe(false);
  expect(result.inputId).toBe('laptop-mic');
  expect(result.outputId).toBe('laptop-output');
});

it('lists changes during recording but defers route changes until unlocked', async () => {
  await render();
  await render(true);
  audio.setOutputDevice.mockClear();
  listed = [...laptop(), ...instrument()];
  await changed();
  expect(result.devices).toHaveLength(4);
  expect(result.inputId).toBe('');
  expect(result.outputId).toBe('');
  expect(result.pending).toBe(true);
  expect(result.status).toBe('deferred');
  expect(audio.setOutputDevice).not.toHaveBeenCalled();
  await render(false);
  expect(result.inputId).toBe('ae20-in');
  expect(result.outputId).toBe('ae20-out');
  expect(result.pending).toBe(false);
});

it('releases temporary permission-check tracks and detects the newly revealed interface', async () => {
  listed = [device('audioinput', '', '')];
  await render();
  expect(result.status).toBe('permission-needed');
  const stop = vi.fn();
  getUserMedia.mockImplementation(async () => {
    listed = instrument();
    return { getTracks: () => [{ stop }] } as unknown as MediaStream;
  });
  await act(async () => result.authorize());
  expect(stop).toHaveBeenCalledOnce();
  expect(result.inputId).toBe('ae20-in');
  expect(result.outputId).toBe('ae20-out');
});

it('shows a permission denial without changing routes or retrying the browser prompt', async () => {
  listed = [device('audioinput', '', '')];
  getUserMedia.mockRejectedValue(new DOMException('Microphone denied', 'NotAllowedError'));
  await render();
  await act(async () => result.authorize());
  expect(result.status).toBe('permission-needed');
  expect(result.error).toContain('Microphone denied');
  expect(result.outputId).toBe('');
  expect(getUserMedia).toHaveBeenCalledOnce();
});

it('reports sink selection failures and keeps the actual prior output and preference', async () => {
  listed = [...laptop(), ...instrument()];
  await render();
  audio.setOutputDevice.mockRejectedValueOnce(new DOMException('Output denied', 'NotAllowedError'));
  await act(async () => result.selectOutput('laptop-output'));
  expect(result.outputId).toBe('ae20-out');
  expect(result.status).toBe('switch-failed');
  expect(result.error).toContain('Output denied');
  expect(localStorage.getItem('dripping.outputDevice')).toBe('ae20-out');
});

it('selects the instrument input but reports system-default output on unsupported browsers', async () => {
  listed = [...laptop(), ...instrument()];
  audio.supported = false;
  await render();
  expect(result.inputId).toBe('ae20-in');
  expect(result.outputId).toBe('');
  expect(result.status).toBe('output-unsupported');
  expect(audio.setOutputDevice).not.toHaveBeenCalled();
  expect(localStorage.getItem('dripping.outputDevice')).toBeNull();
});

it('does not guess an output if two devices match, and falls back visibly when a selected output disappears', async () => {
  listed = [...instrument(), device('audiooutput', 'ae20-other-output', 'AE-20', 'instrument')];
  await render();
  expect(result.inputId).toBe('ae20-in');
  expect(result.status).toBe('input-only');
  expect(audio.setOutputDevice).not.toHaveBeenCalled();
  listed = instrument();
  await changed();
  expect(result.outputId).toBe('ae20-out');
  await act(async () => result.setAutoConnect(false));
  listed = laptop();
  await changed();
  expect(result.outputId).toBe('');
  expect(result.inputId).toBe('ae20-in');
  expect(result.status).toBe('output-disconnected');
  listed = [...laptop(), ...instrument()];
  await changed();
  expect(result.inputId).toBe('ae20-in');
  expect(result.outputId).toBe('ae20-out');
});

it('keeps a disconnected explicit input selected so recording cannot silently use the laptop microphone', async () => {
  listed = [...laptop(), ...instrument()];
  await render();
  listed = laptop();
  await changed();
  expect(result.inputId).toBe('ae20-in');
  expect(result.outputId).toBe('');
  await changed();
  expect(result.inputId).toBe('ae20-in');
  expect(result.status).toBe('input-disconnected');
});

it('releases granted permission tracks even if the component unmounts while the browser prompt is open', async () => {
  await render();
  let finish!: (stream: MediaStream) => void;
  getUserMedia.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  let authorizing!: Promise<void>;
  act(() => {
    authorizing = result.authorize();
  });
  act(() => root.unmount());
  const stop = vi.fn();
  finish({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await authorizing;
  expect(stop).toHaveBeenCalledOnce();
  expect(audio.setOutputDevice).not.toHaveBeenCalled();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

it('ignores stale enumerations after a manual override', async () => {
  await render();
  let finish!: (devices: MediaDeviceInfo[]) => void;
  enumerate.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  let scanning!: Promise<void>;
  act(() => {
    scanning = result.refresh();
  });
  await act(async () => result.selectInput('laptop-mic'));
  await act(async () => {
    finish([...laptop(), ...instrument()]);
    await scanning;
  });
  expect(result.inputId).toBe('laptop-mic');
  expect(result.outputId).toBe('');
  expect(result.autoConnect).toBe(false);
  expect(result.devices).toHaveLength(2);
});

it('corrects an already-started automatic switch when a newer manual output is requested', async () => {
  await render();
  let finish!: () => void;
  audio.setOutputDevice.mockImplementationOnce(
    (id) =>
      new Promise<void>((resolve) => {
        finish = () => {
          audio.actualOutput = id;
          resolve();
        };
      }),
  );
  listed = [...laptop(), ...instrument()];
  let scanning!: Promise<void>;
  await act(async () => {
    scanning = result.refresh();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.routing).toBe(true);
  expect(result.outputId).toBe('');
  let selecting!: Promise<void>;
  act(() => {
    selecting = result.selectOutput('laptop-output');
  });
  await act(async () => {
    finish();
    await Promise.all([scanning, selecting]);
  });
  expect(result.outputId).toBe('laptop-output');
  expect(result.autoConnect).toBe(false);
  expect(result.status).toBe('manual');
  expect(localStorage.getItem('dripping.outputDevice')).toBe('laptop-output');
});

it('does not let a device-list refresh overwrite an in-flight manual output request', async () => {
  listed = [...laptop(), ...instrument()];
  await render();
  let finish!: () => void;
  audio.setOutputDevice.mockImplementationOnce(
    (id) =>
      new Promise<void>((resolve) => {
        finish = () => {
          audio.actualOutput = id;
          resolve();
        };
      }),
  );
  let selecting!: Promise<void>, scanning!: Promise<void>;
  await act(async () => {
    selecting = result.selectOutput('laptop-output');
    await Promise.resolve();
  });
  act(() => {
    scanning = result.refresh();
  });
  await act(async () => {
    finish();
    await Promise.all([selecting, scanning]);
  });
  expect(result.outputId).toBe('laptop-output');
  expect(localStorage.getItem('dripping.outputDevice')).toBe('laptop-output');
  expect(result.autoConnect).toBe(false);
});
