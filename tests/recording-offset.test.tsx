// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordingRouteKey, useRecordingOffset } from '../src/hooks/useRecordingOffset';

const STORAGE = 'dripping.recordingOffsets';
const device = (deviceId: string, kind: MediaDeviceKind, groupId = ''): MediaDeviceInfo => ({
  deviceId,
  kind,
  groupId,
  label: deviceId,
  toJSON: () => ({}),
});
const devices = [
  device('input-a', 'audioinput', 'a'),
  device('output-a', 'audiooutput', 'a'),
  device('input-b', 'audioinput', 'b'),
  device('output-b', 'audiooutput', 'b'),
];
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useRecordingOffset>;
let renderedLatencies: number[];

function Probe({
  list,
  input,
  output,
  channels,
  ready,
}: {
  list: MediaDeviceInfo[];
  input: string;
  output: string;
  channels: string;
  ready: boolean;
}) {
  current = useRecordingOffset(list, input, output, channels, ready);
  renderedLatencies.push(current.latency);
  return <output>{current.latency}</output>;
}
const render = (
  input = 'input-a',
  output = 'output-a',
  channels = '0',
  list = devices,
  ready = true,
) =>
  act(() =>
    root.render(
      <Probe list={list} input={input} output={output} channels={channels} ready={ready} />,
    ),
  );
const remount = () => {
  act(() => root.unmount());
  root = createRoot(host);
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  renderedLatencies = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('keeps independent corrections for each input, output, and channel combination', () => {
  render();
  act(() => current.setLatency(72));
  expect(current.latency).toBe(72);
  expect(current.savedForRoute).toBe(true);

  render('input-b', 'output-b');
  expect(current.latency).toBe(0);
  expect(current.savedForRoute).toBe(false);
  act(() => current.setLatency(25));
  render();
  expect(current.latency).toBe(72);

  render('input-a', 'output-b');
  expect(current.latency).toBe(0);
  render('input-a', 'output-a', '0,1');
  expect(current.latency).toBe(0);
  act(() => current.setLatency(-15));
  render();
  expect(current.latency).toBe(72);
  render('input-b', 'output-b');
  expect(current.latency).toBe(25);
  render('input-a', 'output-a', '0,1');
  expect(current.latency).toBe(-15);
});

it('restores saved route corrections after the component is unmounted and mounted again', () => {
  render();
  act(() => current.setLatency(91));
  render('input-b', 'output-b');
  act(() => current.setLatency(0));
  remount();
  render();
  expect(current.latency).toBe(91);
  expect(current.savedForRoute).toBe(true);
  render('input-b', 'output-b');
  expect(current.latency).toBe(0);
  expect(current.savedForRoute).toBe(true);
});

it('separates system-default routes when the actual output device changes', () => {
  const first = [...devices, device('default', 'audiooutput', 'speakers')],
    second = [...devices, device('default', 'audiooutput', 'interface')];
  render('input-a', '', '0', first);
  act(() => current.setLatency(130));
  render('input-a', '', '0', second);
  expect(current.latency).toBe(0);
  expect(current.savedForRoute).toBe(false);
  act(() => current.setLatency(40));
  render('input-a', '', '0', first);
  expect(current.latency).toBe(130);
});

it.each(['not-json', '[]', 'null'])(
  'ignores malformed or unsupported saved corrections: %s',
  (stored) => {
    localStorage.setItem(STORAGE, stored);
    render();
    expect(current.latency).toBe(0);
    expect(current.savedForRoute).toBe(false);
  },
);

it.each([-501, 1001, 1.25, '50', null])('ignores an invalid saved route value: %s', (value) => {
  const key = recordingRouteKey(devices, 'input-a', 'output-a', '0');
  localStorage.setItem(STORAGE, JSON.stringify({ [key]: value }));
  render();
  expect(current.latency).toBe(0);
  expect(current.savedForRoute).toBe(false);
});

it('rejects invalid updates without overwriting a valid correction', () => {
  render();
  act(() => current.setLatency(42));
  const stored = localStorage.getItem(STORAGE);
  for (const value of [NaN, Infinity, -501, 1001, 1.5]) {
    act(() => current.setLatency(value));
    expect(current.latency).toBe(42);
    expect(localStorage.getItem(STORAGE)).toBe(stored);
  }
});

it('uses a legacy global correction for its initial route without applying it to a different route', () => {
  localStorage.setItem('dripping.latency', '58');
  render();
  expect(current.latency).toBe(58);
  render('input-b', 'output-b');
  expect(current.latency).toBe(0);
  remount();
  render('input-b', 'output-b');
  expect(current.latency).toBe(0);
  render();
  expect(current.latency).toBe(58);
});

it('preserves existing route profiles instead of assigning a stale global correction to a new route', () => {
  const key = recordingRouteKey(devices, 'input-a', 'output-a', '0');
  localStorage.setItem(STORAGE, JSON.stringify({ [key]: 47 }));
  localStorage.setItem('dripping.latency', '120');
  render('input-b', 'output-b');
  expect(current.latency).toBe(0);
  expect(current.savedForRoute).toBe(false);
  render();
  expect(current.latency).toBe(47);
  expect(current.savedForRoute).toBe(true);
});

it('waits for the first inventory before migrating the legacy correction for system-default devices', () => {
  localStorage.setItem('dripping.latency', '64');
  render('', '', '0', [], false);
  expect(current.latency).toBe(0);
  expect(localStorage.getItem(STORAGE)).toBeNull();
  expect(localStorage.getItem('dripping.latency')).toBe('64');
  const settled = [
    device('default', 'audioinput', 'built-in-microphone'),
    device('default', 'audiooutput', 'wired-headphones'),
  ];
  renderedLatencies = [];
  render('', '', '0', settled, true);
  expect(renderedLatencies[0]).toBe(64);
  expect(current.latency).toBe(64);
  expect(current.savedForRoute).toBe(true);
  expect(localStorage.getItem('dripping.latency')).toBeNull();
  expect(JSON.parse(localStorage.getItem(STORAGE)!)).toEqual({
    [recordingRouteKey(settled, '', '', '0')]: 64,
  });
  remount();
  render('', '', '0', settled);
  expect(current.latency).toBe(64);
});

it('migrates to the saved output preference after that output has been restored', () => {
  localStorage.setItem('dripping.latency', '83');
  localStorage.setItem('dripping.outputDevice', 'output-a');
  render('input-a', '', '0', [], false);
  render('input-a', 'output-a', '0', devices, false);
  expect(localStorage.getItem(STORAGE)).toBeNull();
  render('input-a', 'output-a', '0', devices, true);
  expect(current.latency).toBe(83);
  render('input-a', 'output-b');
  expect(current.latency).toBe(0);
});

it('does not assign legacy correction to a newly auto-selected instrument while settling', () => {
  localStorage.setItem('dripping.latency', '96');
  const settled = [
    ...devices,
    device('default', 'audioinput', 'built-in-microphone'),
    device('default', 'audiooutput', 'built-in-speakers'),
  ];
  render('', '', '0', [], false);
  render('input-b', 'output-b', '0', settled, true);
  expect(current.latency).toBe(0);
  expect(current.savedForRoute).toBe(false);
  expect(localStorage.getItem('dripping.latency')).toBeNull();
  render('', '', '0', settled);
  expect(current.latency).toBe(96);
  remount();
  render('input-b', 'output-b', '0', settled);
  expect(current.latency).toBe(0);
});
