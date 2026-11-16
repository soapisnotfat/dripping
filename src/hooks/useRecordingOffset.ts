import { useEffect, useRef, useState } from 'react';

const STORAGE = 'dripping.recordingOffsets';
type Offsets = Record<string, number>;
const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= -500 && value <= 1000;

export function recordingRouteKey(
  devices: MediaDeviceInfo[],
  inputId: string,
  outputId: string,
  channels: string,
) {
  const identity = (kind: MediaDeviceKind, id: string) => {
    if (id && id !== 'default') return id;
    const device = devices.find((item) => item.kind === kind && item.deviceId === 'default');
    return device?.groupId || device?.label || 'system-default';
  };
  return JSON.stringify([
    identity('audioinput', inputId),
    identity('audiooutput', outputId),
    channels,
  ]);
}

function loadOffsets() {
  const stored = localStorage.getItem(STORAGE);
  let offsets: Offsets = {};
  try {
    const parsed: unknown = JSON.parse(stored || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      offsets = Object.fromEntries(Object.entries(parsed).filter(([, value]) => valid(value)));
  } catch {}
  const legacy = localStorage.getItem('dripping.latency');
  return {
    offsets,
    legacy: stored === null && legacy !== null && valid(Number(legacy)) ? Number(legacy) : null,
    pendingMigration: legacy !== null,
  };
}

export function useRecordingOffset(
  devices: MediaDeviceInfo[],
  inputId: string,
  outputId: string,
  channels: string,
  ready = true,
) {
  const rememberedRoute = useRef({
      inputId,
      outputId: localStorage.getItem('dripping.outputDevice') || outputId,
      channels,
    }),
    key = recordingRouteKey(devices, inputId, outputId, channels),
    legacyKey = recordingRouteKey(
      devices,
      rememberedRoute.current.inputId,
      rememberedRoute.current.outputId,
      rememberedRoute.current.channels,
    ),
    [state, setState] = useState(loadOffsets);
  // The first render can precede both device enumeration and restoration of a
  // saved output. Wait for those before binding the old global correction to
  // the remembered route; an automatically discovered instrument is a new route.
  useEffect(() => {
    if (!ready || !state.pendingMigration) return;
    const offsets =
      state.legacy !== null && !Object.hasOwn(state.offsets, legacyKey)
        ? { ...state.offsets, [legacyKey]: state.legacy }
        : state.offsets;
    if (state.legacy !== null) localStorage.setItem(STORAGE, JSON.stringify(offsets));
    localStorage.removeItem('dripping.latency');
    setState({ offsets, legacy: null, pendingMigration: false });
  }, [ready, legacyKey, state]);
  // Return the pending migration immediately on the settled route, so recording
  // cannot capture a transient zero before the effect persists that correction.
  const pendingLegacy = ready && state.pendingMigration && key === legacyKey ? state.legacy : null,
    savedForRoute = Object.hasOwn(state.offsets, key) || pendingLegacy !== null,
    latency = state.offsets[key] ?? pendingLegacy ?? 0;
  const setLatency = (value: number) => {
    if (!valid(value)) return;
    const next = { ...state.offsets, [key]: value };
    localStorage.setItem(STORAGE, JSON.stringify(next));
    setState({ ...state, offsets: next });
  };
  return { latency, setLatency, savedForRoute };
}
