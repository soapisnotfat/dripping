import type { RecordingWaveformPacket } from './recording-waveform';

export type RecordingWaveformClock = { start: number; speed?: number; latencyMs?: number };
type WaveformTiming = { frameCount: number; sampleRate: number };

// Match finishTake's placement of the dry capture, including practice speed and
// timing correction. The waveform keeps its original source-frame coordinates.
export function recordingFrameTime(
  session: RecordingWaveformClock,
  waveform: Pick<WaveformTiming, 'sampleRate'>,
  frame: number,
) {
  const speed = session.speed ?? 1;
  return (
    session.start -
    ((session.latencyMs ?? 0) / 1000) * speed +
    (waveform.sampleRate > 0 ? (frame / waveform.sampleRate) * speed : 0)
  );
}

export function recordingWaveformBounds(session: RecordingWaveformClock, waveform: WaveformTiming) {
  const rawStart = recordingFrameTime(session, waveform, 0),
    start = Math.max(0, rawStart),
    end = Math.max(start, recordingFrameTime(session, waveform, waveform.frameCount)),
    sourceStart = Math.max(0, -rawStart) / (session.speed ?? 1);
  return { rawStart, start, end, sourceStart };
}

// Only envelopes are retained. Grow geometrically, then merge adjacent bins as
// needed: even very long recordings keep their full time axis at bounded memory.
export class LiveWaveform {
  readonly maxBins: number;
  frameCount = 0;
  sampleRate = 0;
  binFrames = 0;
  binCount = 0;
  revision = 0;
  min: Float32Array[] = [];
  max: Float32Array[] = [];
  private capacity = 0;
  private sourceBinFrames = 0;

  constructor(maxBins = 90000) {
    if (!Number.isSafeInteger(maxBins) || maxBins < 2)
      throw Error('Waveform capacity must contain at least two bins');
    this.maxBins = maxBins;
  }

  get channelCount() {
    return this.min.length;
  }

  append(packet: RecordingWaveformPacket): boolean {
    const count = packet.frames.length,
      channels = packet.min.length;
    if (
      !count ||
      !channels ||
      channels !== packet.max.length ||
      !Number.isSafeInteger(packet.startFrame) ||
      packet.startFrame !== this.frameCount ||
      !Number.isSafeInteger(packet.sampleRate) ||
      packet.sampleRate <= 0 ||
      !Number.isSafeInteger(packet.framesPerBin) ||
      packet.framesPerBin <= 0 ||
      (this.sampleRate !== 0 &&
        (packet.sampleRate !== this.sampleRate ||
          packet.framesPerBin !== this.sourceBinFrames ||
          channels !== this.channelCount)) ||
      packet.min.some((values) => values.length !== count) ||
      packet.max.some((values) => values.length !== count)
    )
      return false;
    let addedFrames = 0;
    for (let index = 0; index < count; index++) {
      const frames = packet.frames[index];
      if (!Number.isSafeInteger(frames) || frames <= 0 || frames > packet.framesPerBin)
        return false;
      addedFrames += frames;
      for (let channel = 0; channel < channels; channel++) {
        const low = packet.min[channel][index],
          high = packet.max[channel][index];
        if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return false;
      }
    }
    const endFrame = this.frameCount + addedFrames;
    if (!Number.isSafeInteger(endFrame)) return false;
    if (!this.sampleRate) {
      this.sampleRate = packet.sampleRate;
      this.sourceBinFrames = this.binFrames = packet.framesPerBin;
      this.min = Array.from({ length: channels }, () => new Float32Array(0));
      this.max = Array.from({ length: channels }, () => new Float32Array(0));
    }
    while (Math.ceil(endFrame / this.binFrames) > this.maxBins) this.compact();
    const needed = Math.ceil(endFrame / this.binFrames);
    this.reserve(needed);
    for (let channel = 0; channel < channels; channel++) {
      this.min[channel].fill(Infinity, this.binCount, needed);
      this.max[channel].fill(-Infinity, this.binCount, needed);
    }
    let frame = packet.startFrame;
    for (let index = 0; index < count; index++) {
      const end = frame + packet.frames[index],
        first = Math.floor(frame / this.binFrames),
        last = Math.floor((end - 1) / this.binFrames);
      // Source bins normally align. If a partial packet is followed by more
      // data, retaining its envelope on both overlapping bins preserves peaks.
      for (let bin = first; bin <= last; bin++)
        for (let channel = 0; channel < channels; channel++) {
          this.min[channel][bin] = Math.min(this.min[channel][bin], packet.min[channel][index]);
          this.max[channel][bin] = Math.max(this.max[channel][bin], packet.max[channel][index]);
        }
      frame = end;
    }
    this.frameCount = endFrame;
    this.binCount = needed;
    this.revision++;
    return true;
  }

  private reserve(needed: number) {
    if (needed <= this.capacity) return;
    const capacity = Math.min(this.maxBins, Math.max(needed, this.capacity * 2, 256));
    this.min = this.min.map((values) => {
      const next = new Float32Array(capacity);
      next.set(values);
      return next;
    });
    this.max = this.max.map((values) => {
      const next = new Float32Array(capacity);
      next.set(values);
      return next;
    });
    this.capacity = capacity;
  }

  private compact() {
    const count = Math.ceil(this.binCount / 2);
    for (let channel = 0; channel < this.channelCount; channel++)
      for (let index = 0; index < count; index++) {
        const first = index * 2,
          second = first + 1;
        this.min[channel][index] =
          second < this.binCount
            ? Math.min(this.min[channel][first], this.min[channel][second])
            : this.min[channel][first];
        this.max[channel][index] =
          second < this.binCount
            ? Math.max(this.max[channel][first], this.max[channel][second])
            : this.max[channel][first];
      }
    this.binFrames *= 2;
    this.binCount = count;
  }
}
