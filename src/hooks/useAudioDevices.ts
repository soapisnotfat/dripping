import { useCallback, useEffect, useRef, useState } from 'react';
import { aerophoneModel, findAutomaticAudioPair } from '../lib/audio-devices';
import { transport } from '../lib/transport';
import { inputConstraints } from '../lib/input';

export type AudioRoutingStatus =
  | 'detecting'
  | 'automatic'
  | 'manual'
  | 'permission-needed'
  | 'no-device'
  | 'multiple-devices'
  | 'input-only'
  | 'output-unsupported'
  | 'deferred'
  | 'input-disconnected'
  | 'output-disconnected'
  | 'switch-failed'
  | 'unavailable';

type OutputMediaDevices = MediaDevices & {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
};

const INPUT = 'dripping.inputDevice',
  OUTPUT = 'dripping.outputDevice',
  AUTO = 'dripping.autoConnectAudio';

export function useAudioDevices({ locked }: { locked: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [inputId, setInputId] = useState(() => localStorage.getItem(INPUT) || ''),
    [outputId, setOutputId] = useState(() => transport.outputDeviceId),
    [autoConnect, setAuto] = useState(() => localStorage.getItem(AUTO) !== 'false'),
    [routing, setRouting] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState<AudioRoutingStatus>('detecting');
  const mounted = useRef(false),
    lockedRef = useRef(locked),
    mode = useRef(autoConnect),
    input = useRef(inputId),
    output = useRef(outputId),
    inputPreference = useRef(inputId),
    outputPreference = useRef(localStorage.getItem(OUTPUT) || ''),
    requestedOutput = useRef<string | null>(null),
    generation = useRef(0),
    active = useRef(0),
    routes = useRef(Promise.resolve());
  lockedRef.current = locked;

  const current = useCallback(
    (token: number) => mounted.current && token === generation.current,
    [],
  );
  const markBusy = useCallback((delta: number) => {
    active.current += delta;
    if (mounted.current) setRouting(active.current > 0);
  }, []);
  const defer = useCallback(() => {
    if (!mounted.current) return;
    setPending(true);
    setStatus('deferred');
  }, []);
  const applyInput = useCallback((id: string, persist: boolean) => {
    input.current = id;
    setInputId(id);
    if (persist) {
      inputPreference.current = id;
      localStorage.setItem(INPUT, id);
    }
  }, []);
  const syncOutput = useCallback(() => {
    output.current = transport.outputDeviceId;
    if (mounted.current) setOutputId(output.current);
  }, []);
  const routeOutput = useCallback(
    (id: string, token: number, persist: boolean): Promise<boolean> => {
      let applied = false;
      const operation = routes.current.then(async () => {
        if (!current(token)) return;
        if (lockedRef.current) {
          defer();
          return;
        }
        await transport.setOutputDevice(id);
        // A native switch cannot be canceled. Always reflect its actual result,
        // but let the latest queued policy decide which route should remain.
        syncOutput();
        if (!current(token)) return;
        if (lockedRef.current) {
          defer();
          return;
        }
        if (persist) {
          outputPreference.current = id;
          localStorage.setItem(OUTPUT, id);
          if (requestedOutput.current === id) requestedOutput.current = null;
        }
        applied = true;
      });
      routes.current = operation.catch(() => {});
      return operation.then(() => applied);
    },
    [current, defer, syncOutput],
  );

  const refresh = useCallback(async () => {
    const token = ++generation.current;
    if (!navigator.mediaDevices?.enumerateDevices) {
      if (mounted.current) {
        setStatus('unavailable');
        setError('浏览器无法列出音频设备 / Audio devices are unavailable in this browser');
      }
      return;
    }
    markBusy(1);
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (!current(token)) return;
      setDevices(list);
      syncOutput();
      setError('');
      if (lockedRef.current) {
        defer();
        return;
      }
      setPending(false);
      const inputs = list.filter((device) => device.kind === 'audioinput'),
        visible = list.some(
          (device) =>
            (device.kind === 'audioinput' || device.kind === 'audiooutput') && device.label,
        ),
        present = (kind: 'audioinput' | 'audiooutput', id: string) =>
          !id || list.some((device) => device.kind === kind && device.deviceId === id);
      if (!visible || (mode.current && !inputs.some((device) => device.label))) {
        setStatus('permission-needed');
        return;
      }
      let disconnected: AudioRoutingStatus | null = null;
      if (input.current && !present('audioinput', input.current)) {
        disconnected = 'input-disconnected';
      }
      if (output.current && !present('audiooutput', output.current)) {
        if (!(await routeOutput('', token, false))) return;
        disconnected = 'output-disconnected';
      }
      if (mode.current) {
        const pair = findAutomaticAudioPair(list, inputPreference.current);
        if (pair) {
          applyInput(pair.input.deviceId, true);
          if (!transport.supportsOutputSelection) {
            setStatus('output-unsupported');
          } else if (!pair.output) {
            setStatus('input-only');
          } else if (await routeOutput(pair.output.deviceId, token, true)) {
            setStatus('automatic');
          }
        } else {
          const known = new Set(
            inputs
              .filter(
                (device) =>
                  device.deviceId !== 'default' &&
                  device.deviceId !== 'communications' &&
                  aerophoneModel(device.label),
              )
              .map((device) => device.deviceId),
          );
          setStatus(disconnected ?? (known.size > 1 ? 'multiple-devices' : 'no-device'));
        }
      } else {
        const wanted = requestedOutput.current ?? outputPreference.current;
        if (present('audioinput', inputPreference.current))
          applyInput(inputPreference.current, false);
        else disconnected = 'input-disconnected';
        if (!transport.supportsOutputSelection) {
          setStatus(disconnected ?? 'output-unsupported');
        } else if (requestedOutput.current === null && wanted && !present('audiooutput', wanted)) {
          if (await routeOutput('', token, false)) setStatus('output-disconnected');
        } else if (await routeOutput(wanted, token, true)) {
          setStatus(disconnected ?? 'manual');
        }
      }
    } catch (cause) {
      if (current(token)) {
        requestedOutput.current = null;
        setError(String(cause).replace(/^Error: /, ''));
        setStatus('switch-failed');
        syncOutput();
      }
    } finally {
      markBusy(-1);
    }
  }, [applyInput, current, defer, markBusy, routeOutput, syncOutput]);

  const setAutoConnect = useCallback(
    (value: boolean) => {
      ++generation.current;
      mode.current = value;
      requestedOutput.current = null;
      setAuto(value);
      localStorage.setItem(AUTO, String(value));
      if (!value) {
        // Freeze the currently applied route, even if an obsolete automatic
        // switch is still in flight and has to be corrected afterwards.
        outputPreference.current = output.current;
        requestedOutput.current = output.current;
        localStorage.setItem(OUTPUT, output.current);
      }
      void refresh();
    },
    [refresh],
  );
  const selectInput = useCallback(
    async (id: string) => {
      if (lockedRef.current) {
        defer();
        return;
      }
      const token = ++generation.current,
        keepOutput = output.current;
      mode.current = false;
      setAuto(false);
      localStorage.setItem(AUTO, 'false');
      applyInput(id, true);
      outputPreference.current = keepOutput;
      requestedOutput.current = keepOutput;
      setError('');
      setPending(false);
      markBusy(1);
      try {
        if (await routeOutput(keepOutput, token, true))
          setStatus(transport.supportsOutputSelection ? 'manual' : 'output-unsupported');
      } catch (cause) {
        if (current(token)) {
          requestedOutput.current = null;
          setError(String(cause).replace(/^Error: /, ''));
          setStatus('switch-failed');
        }
      } finally {
        markBusy(-1);
      }
    },
    [applyInput, current, defer, markBusy, routeOutput],
  );
  const selectOutput = useCallback(
    async (id: string) => {
      if (lockedRef.current) {
        defer();
        return;
      }
      const token = ++generation.current;
      mode.current = false;
      requestedOutput.current = id;
      setAuto(false);
      localStorage.setItem(AUTO, 'false');
      setError('');
      setPending(false);
      markBusy(1);
      try {
        if (await routeOutput(id, token, true))
          setStatus(transport.supportsOutputSelection ? 'manual' : 'output-unsupported');
      } catch (cause) {
        if (current(token)) {
          requestedOutput.current = null;
          setError(String(cause).replace(/^Error: /, ''));
          setStatus('switch-failed');
          syncOutput();
        }
      } finally {
        markBusy(-1);
      }
    },
    [current, defer, markBusy, routeOutput, syncOutput],
  );
  const authorize = useCallback(async () => {
    if (lockedRef.current) {
      defer();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setError('浏览器无法打开音频输入 / Audio input is unavailable in this browser');
      return;
    }
    const token = ++generation.current;
    markBusy(1);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputConstraints('', [0]));
      stream.getTracks().forEach((track) => track.stop());
      stream = undefined;
      if (current(token)) await refresh();
    } catch (cause) {
      if (current(token)) {
        setError(String(cause).replace(/^Error: /, ''));
        setStatus('permission-needed');
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      markBusy(-1);
    }
  }, [current, defer, markBusy, refresh]);
  const authorizeOutput = useCallback(async () => {
    const media = navigator.mediaDevices as OutputMediaDevices | undefined;
    if (lockedRef.current) {
      defer();
      return;
    }
    if (!media?.selectAudioOutput) {
      setError('请在系统声音设置中选择输出 / Choose the audio output in system sound settings');
      setStatus('output-unsupported');
      return;
    }
    const token = ++generation.current;
    try {
      const selected = await media.selectAudioOutput({ deviceId: outputPreference.current });
      if (!current(token)) return;
      if (lockedRef.current) {
        defer();
        return;
      }
      const list = await media.enumerateDevices();
      if (!current(token)) return;
      setDevices(list);
      await selectOutput(selected.deviceId);
    } catch (cause) {
      if (current(token)) {
        setError(String(cause).replace(/^Error: /, ''));
        setStatus('switch-failed');
      }
    }
  }, [current, defer, selectOutput]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', changed);
    return () => {
      mounted.current = false;
      ++generation.current;
      navigator.mediaDevices?.removeEventListener?.('devicechange', changed);
    };
  }, [refresh]);
  useEffect(() => {
    if (locked && active.current) defer();
    void refresh();
  }, [locked, defer, refresh]);

  return {
    devices,
    inputId,
    outputId,
    autoConnect,
    setAutoConnect,
    selectInput,
    selectOutput,
    refresh,
    authorize,
    authorizeOutput,
    routing,
    pending,
    error,
    status,
    supportsOutputSelection: transport.supportsOutputSelection,
  };
}
