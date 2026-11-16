import { useEffect, useRef, type RefObject } from 'react';
import type { Locale, RecordingSession } from '../lib/types';
import { recordingWaveformBounds, type LiveWaveform } from '../lib/live-waveform';

type Capture = Pick<RecordingSession, 'start'> &
  Partial<Pick<RecordingSession, 'speed' | 'latencyMs'>>;

// Only allocate a canvas for the visible lane, even for a long recording.
// The peak buffer stays outside React state and grows with captured samples.
export function RecordingWaveform({
  waveform,
  capture,
  scale,
  viewport,
  locale,
}: {
  waveform: LiveWaveform;
  capture: Capture;
  scale: number;
  viewport: RefObject<HTMLDivElement | null>;
  locale: Locale;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let animation = 0,
      last = 0,
      painted = '';
    const draw = (now: number) => {
      animation = requestAnimationFrame(draw);
      if (now - last < 30) return;
      last = now;
      const el = canvas.current,
        scroller = viewport.current,
        region = el?.parentElement;
      if (!el || !scroller || !region) return;
      const rect = region.getBoundingClientRect(),
        view = scroller.getBoundingClientRect(),
        left = Math.max(0, view.left + 190 - rect.left),
        width = Math.max(
          0,
          Math.min(6000, rect.width - left, view.left + scroller.clientWidth - rect.left - left),
        ),
        height = Math.max(1, rect.height - 22),
        ratio = Math.min(2, window.devicePixelRatio || 1),
        key = `${waveform.revision}:${left}:${width}:${height}:${ratio}`;
      if (key === painted) return;
      painted = key;
      el.dataset.recordedFrames = String(waveform.frameCount);
      el.dataset.binCount = String(waveform.binCount);
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.width = Math.max(1, Math.ceil(width * ratio));
      el.height = Math.ceil(height * ratio);
      const ctx = el.getContext('2d');
      if (!ctx || !width || !waveform.binCount) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const bounds = recordingWaveformBounds(capture, waveform),
        speed = capture.speed ?? 1,
        secondsPerBin = (waveform.binFrames / waveform.sampleRate) * speed,
        channelHeight = height / waveform.channelCount;
      ctx.fillStyle = getComputedStyle(el).getPropertyValue('--red').trim() || '#a34447';
      for (let channel = 0; channel < waveform.channelCount; channel++) {
        const center = channelHeight * (channel + 0.5),
          amplitude = Math.max(1, channelHeight / 2 - 3);
        ctx.globalAlpha = 0.25;
        ctx.fillRect(0, center, width, 1);
        ctx.globalAlpha = 0.95;
        for (let x = 0; x < width; x++) {
          const first = Math.max(
              0,
              Math.floor((bounds.start - bounds.rawStart + (left + x) / scale) / secondsPerBin),
            ),
            end = Math.min(
              waveform.binCount,
              Math.ceil((bounds.start - bounds.rawStart + (left + x + 1) / scale) / secondsPerBin),
            );
          let min = Infinity,
            max = -Infinity;
          for (let bin = first; bin < end; bin++) {
            min = Math.min(min, waveform.min[channel][bin]);
            max = Math.max(max, waveform.max[channel][bin]);
          }
          if (min <= max)
            ctx.fillRect(
              x,
              center - Math.min(1, max) * amplitude,
              1,
              Math.max(1, (Math.min(1, max) - Math.max(-1, min)) * amplitude),
            );
        }
      }
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [waveform, capture.start, capture.speed, capture.latencyMs, scale, viewport]);
  return (
    <canvas
      ref={canvas}
      className="recording-waveform"
      role="img"
      aria-label={locale === 'zh' ? '正在录制的输入波形' : 'Live recording input waveform'}
    />
  );
}
