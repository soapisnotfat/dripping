import type { Project, PCM } from './types';
import { projectDuration, qToSeconds, beatGrid } from './time';
import { soundingEvents } from './score';

// Lightweight synthesized cues: a sustained flute and a percussive piano.
function referenceNote(
  frequency: number,
  duration: number,
  instrument: 'flute' | 'piano',
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, Math.round(duration * sampleRate)));
  let phase = 0,
    noise = 12345;
  const harmonics = [1, 0.52, 0.3, 0.18, 0.1, 0.06];
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate,
      release = Math.min(1, (out.length - i) / sampleRate / 0.035);
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    const breath = (noise / 4294967296) * 2 - 1;
    if (instrument === 'flute') {
      const vibrato = 0.0025 * Math.min(1, t / 0.25) * Math.sin(2 * Math.PI * 5.2 * t);
      phase += (2 * Math.PI * frequency * (1 + vibrato)) / sampleRate;
      const envelope = Math.min(1, t / 0.055) * release;
      out[i] =
        0.19 *
        envelope *
        (0.95 * Math.sin(phase) +
          0.06 * Math.sin(2 * phase) +
          0.02 * Math.sin(3 * phase) +
          0.012 * breath);
    } else {
      let tone = 0;
      for (let h = 1; h <= harmonics.length; h++) {
        const partial = frequency * h * Math.sqrt(1 + 0.00025 * (h * h - 1));
        if (partial >= sampleRate * 0.45) continue;
        tone +=
          harmonics[h - 1] *
          Math.exp(-(2.7 + 0.75 * (h - 1)) * t) *
          Math.sin(2 * Math.PI * partial * t);
      }
      const envelope = Math.min(1, t / 0.003) * release;
      out[i] = 0.17 * envelope * (tone + 0.07 * breath * Math.exp(-100 * t));
    }
  }
  return out;
}
export function referencePCM(project: Project, instrument: 'flute' | 'piano' = 'flute'): PCM {
  const sr = 22050,
    out = new Float32Array(Math.ceil(projectDuration(project) * sr));
  if (project.score)
    for (const event of soundingEvents(project.score)) {
      const start = qToSeconds(event.q, project.scoreMap),
        end = qToSeconds(event.q + event.duration, project.scoreMap);
      const a = Math.round(start * sr),
        frequency = 440 * 2 ** ((event.midi! - 69) / 12);
      if (a >= out.length || end <= 0) continue;
      const note = referenceNote(frequency, end - start, instrument, sr);
      for (let i = Math.max(0, -a); i < note.length && a + i < out.length; i++)
        out[a + i] += note[i];
    }
  return { sampleRate: sr, channels: [out] };
}
export function metronomePCM(project: Project, speed: number, sampleRate = 22050): PCM {
  const out = new Float32Array(Math.ceil((projectDuration(project) / speed) * sampleRate));
  if (project.score) {
    const starts = new Set(project.score.route.map((m) => m.q));
    for (const q of beatGrid(project.score)) {
      if (q >= project.score.totalQ) continue;
      const a = Math.round((qToSeconds(q, project.scoreMap) / speed) * sampleRate),
        f = starts.has(q) ? 1600 : 1100;
      for (let i = 0; i < sampleRate * 0.045 && a + i < out.length; i++)
        if (a + i >= 0)
          out[a + i] +=
            0.22 * Math.sin((2 * Math.PI * f * i) / sampleRate) * Math.exp((-i / sampleRate) * 90);
    }
  }
  return { sampleRate, channels: [out] };
}
