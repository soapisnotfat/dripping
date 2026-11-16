import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../lib/types';
import { PCMRecorder } from '../lib/recorder';
import { transport } from '../lib/transport';

export function InputMeter({
  device,
  channels,
  locale,
  onError,
  disabled = false,
  onRunningChange,
}: {
  device: string;
  channels: string;
  locale: Locale;
  onError: (message: string) => void;
  disabled?: boolean;
  onRunningChange?: (running: boolean) => void;
}) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const selected = channels.split(',').map(Number);
  const probe = useRef<PCMRecorder | null>(null),
    generation = useRef(0);
  const [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [levels, setLevels] = useState<number[]>([]);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    onRunningChange?.(running || starting);
  }, [running, starting, onRunningChange]);
  useEffect(() => () => onRunningChange?.(false), [onRunningChange]);
  const stop = () => {
    generation.current++;
    probe.current?.close();
    probe.current = null;
    setRunning(false);
    setStarting(false);
    setLevels([]);
    setClipped(false);
  };
  useEffect(() => {
    stop();
    return () => {
      generation.current++;
      probe.current?.close();
      probe.current = null;
    };
  }, [device, channels]);
  const start = async () => {
    const token = ++generation.current;
    setStarting(true);
    const input = new PCMRecorder(transport.ctx);
    probe.current = input;
    input.onMeter = (peak, peaks, clipped) => {
      if (token === generation.current) {
        setLevels(peaks || [peak]);
        if (clipped) setClipped(true);
      }
    };
    input.onError = (message) => {
      if (token === generation.current) {
        stop();
        onError(message);
      }
    };
    input.onEnded = () => {
      if (token === generation.current) stop();
    };
    try {
      await transport.ctx.resume();
      await input.open(device, selected);
      input.setMonitoring(false);
      if (token !== generation.current) {
        input.close();
        return;
      }
      setRunning(true);
      setLevels(selected.map(() => 0));
    } catch (error) {
      input.close();
      if (token === generation.current) {
        probe.current = null;
        setRunning(false);
        onError(String(error));
      }
    } finally {
      if (token === generation.current) setStarting(false);
    }
  };
  return (
    <div className="input-meter-panel">
      <div className="input-meter-heading">
        <span>{t('所选通道电平', 'Selected input levels')}</span>
        <button
          disabled={starting || (disabled && !running)}
          onClick={() => (running ? stop() : void start())}
        >
          {starting
            ? t('连接中…', 'Connecting…')
            : running
              ? t('停止检测', 'Stop level check')
              : t('检测输入电平', 'Check input levels')}
        </button>
      </div>
      {selected.map((channel, index) => {
        const peak = levels[index] || 0,
          db = peak > 0 ? 20 * Math.log10(peak) : -Infinity,
          level = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        return (
          <div className={`input-meter-channel ${peak >= 0.98 ? 'near-peak' : ''}`} key={channel}>
            <span>
              {t('通道', 'Channel')} {channel + 1}
            </span>
            <meter
              aria-label={`${t('通道', 'Channel')} ${channel + 1}`}
              min="0"
              max="1"
              value={peak}
            />
            <i aria-hidden="true">
              <b style={{ width: `${level}%` }} />
            </i>
            <output>
              {running
                ? Number.isFinite(db)
                  ? `${db.toFixed(1)} dBFS`
                  : t('无信号', 'No signal')
                : '—'}
            </output>
          </div>
        );
      })}
      {clipped && (
        <strong className="input-clip-warning" role="status">
          {t(
            '峰值接近 0 dBFS，请降低设备的输入增益后重测。',
            'Peak approached 0 dBFS. Lower the device input gain and check again.',
          )}
        </strong>
      )}
      <small>
        {running
          ? t(
              '演奏几秒，检查通道与电平。此检测不录音、不播放输入声。',
              'Play a few notes to check channels and levels. This check does not record or monitor your input.',
            )
          : t(
              '点检测后才打开输入；关闭窗口或更换设备会停止。',
              'Input opens only when you start the check. Closing this window or changing inputs stops it.',
            )}
      </small>
    </div>
  );
}
