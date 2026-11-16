import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale, PCM } from '../lib/types';
import { clamp } from '../lib/types';
import { peaks, slicePCM } from '../lib/audio';
import { transport } from '../lib/transport';

export function SourcePoint({
  pcm,
  position,
  step,
  disabled,
  locale,
  gainDb,
  onPosition,
  onError,
}: {
  pcm: PCM;
  position: number;
  step: number;
  disabled: boolean;
  locale: Locale;
  gainDb: number;
  onPosition: (value: number) => void;
  onError: (message: string) => void;
}) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en),
    host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    node = useRef<AudioBufferSourceNode | null>(null),
    request = useRef(0);
  const [detail, setDetail] = useState(false),
    [from, setFrom] = useState(0),
    [width, setWidth] = useState(600),
    [playing, setPlaying] = useState(false),
    duration = pcm.channels[0].length / pcm.sampleRate,
    span = detail ? Math.min(duration, step * 64) : duration,
    begin = detail ? clamp(from, 0, Math.max(0, duration - span)) : 0,
    end = begin + span;
  const stop = () => {
    request.current++;
    if (node.current) {
      node.current.onended = null;
      try {
        node.current.stop();
      } catch {
        /* Already ended. */
      }
      node.current = null;
    }
    setPlaying(false);
  };
  useEffect(
    () => () => {
      request.current++;
      if (node.current) {
        node.current.onended = null;
        try {
          node.current.stop();
        } catch {
          /* Already ended. */
        }
      }
    },
    [pcm],
  );
  useEffect(() => {
    if (detail && (position < begin || position > end)) setFrom(Math.max(0, position - span / 2));
  }, [position, detail, begin, end, span]);
  useEffect(() => {
    if (!host.current) return;
    const resize = new ResizeObserver(() => setWidth(host.current?.clientWidth || 600));
    resize.observe(host.current);
    return () => resize.disconnect();
  }, []);
  const wave = useMemo(
    () => peaks(detail ? slicePCM(pcm, begin, end) : pcm, Math.max(200, Math.round(width * 2))),
    [pcm, begin, end, width, detail],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = devicePixelRatio || 1;
    element.width = Math.round(width * ratio);
    element.height = 76 * ratio;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.strokeStyle = getComputedStyle(element).getPropertyValue('--accent') || '#819c64';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = (i / Math.max(1, wave.length - 1)) * width,
        y = Math.min(1, wave[i]) * 33;
      ctx.moveTo(x, 38 - y);
      ctx.lineTo(x, 38 + y);
    }
    ctx.stroke();
  }, [wave, width]);
  const choose = (value: number) => {
    stop();
    onPosition(clamp(value, 0, Math.max(0, duration - 1 / pcm.sampleRate)));
  };
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return begin + clamp((event.clientX - rect.left) / rect.width, 0, 1) * span;
  };
  const play = async () => {
    if (playing) {
      stop();
      return;
    }
    if (position < 0 || position >= duration) return;
    const token = ++request.current;
    try {
      const source = await transport.auditionRaw(pcm, position, step * 32, gainDb);
      if (token !== request.current) {
        source.stop();
        return;
      }
      node.current = source;
      source.onended = () => {
        if (token === request.current) {
          node.current = null;
          setPlaying(false);
        }
      };
      setPlaying(true);
    } catch (error) {
      onError(String(error));
    }
  };
  return (
    <div className="source-point">
      <div className="source-point-heading">
        <span>{t('原始音频中的位置', 'Point in original audio')}</span>
        <button
          type="button"
          aria-pressed={detail}
          disabled={disabled}
          onClick={() => {
            setFrom(
              Math.max(0, position - (detail ? duration : Math.min(duration, step * 64)) / 2),
            );
            setDetail(!detail);
          }}
        >
          {detail ? t('全段', 'Whole source') : t('放大此处', 'Zoom here')}
        </button>
        <button
          type="button"
          disabled={disabled || position < 0 || position >= duration}
          onClick={() => void play()}
        >
          {playing ? t('停止原音', 'Stop source') : t('试听此处原音', 'Play source here')}
        </button>
      </div>
      <div
        ref={host}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={t('原音频定位', 'Source audio point')}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, pcm.channels[0].length - 1)}
        aria-valuenow={Math.min(
          pcm.channels[0].length - 1,
          Math.round(clamp(position, 0, duration) * pcm.sampleRate),
        )}
        aria-valuetext={
          position < 0
            ? t('在已录音频开始前', 'Before recorded audio')
            : position >= duration
              ? t('在已录音频结束后', 'After recorded audio')
              : `${(clamp(position / duration, 0, 1) * 100).toFixed(1)}% ${t('原始音频', 'of source')}`
        }
        className="source-wave"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          choose(point(event));
        }}
        onPointerMove={(event) => {
          if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId))
            choose(point(event));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            choose(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? duration
                  : position + (event.key === 'ArrowRight' ? step : -step),
            );
          }
        }}
      >
        <canvas ref={canvas} />
        <i style={{ left: `${clamp((position - begin) / Math.max(0.001, span), 0, 1) * 100}%` }} />
      </div>
      <small>
        {t(
          '选择并试听原音位置，再配对到谱面的小节与拍。',
          'Choose and audition the source point, then pair it with a score bar and beat.',
        )}
      </small>
    </div>
  );
}
