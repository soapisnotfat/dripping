// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { demoXml } from '../src/lib/demo';
import { parseScore, soundingEvents, setNotationInstrument } from '../src/lib/score';
import { audioFeatures, alignToScore, conformAudio } from '../src/lib/alignment';
import { assessAlignment } from '../src/lib/alignment-evidence';
import { tempoMap, qToSeconds, secondsToQ } from '../src/lib/time';

function trimmedExercise(changeTempo = false) {
  const doc = new DOMParser().parseFromString(demoXml(), 'application/xml'),
    part = doc.querySelector('part')!,
    first = part.querySelector('measure')!,
    notes = Array.from(first.querySelectorAll('note'));
  for (const note of notes.slice(0, 3)) note.remove();
  const rest = doc.createElement('note');
  rest.innerHTML = '<rest/><duration>12</duration><type>half</type><dot/>';
  first.insertBefore(rest, first.querySelector('note'));
  if (changeTempo) {
    rest.querySelector('duration')!.textContent = '8';
    const tempo = doc.createElement('direction');
    tempo.innerHTML = '<sound tempo="60"/>';
    const later = doc.createElement('note');
    later.innerHTML = '<rest/><duration>4</duration><type>quarter</type>';
    rest.after(tempo, later);
  }
  const last = doc.createElement('measure');
  last.setAttribute('number', '17');
  last.innerHTML = '<note><rest measure="yes"/><duration>16</duration><type>whole</type></note>';
  part.append(last);
  const xml = new XMLSerializer().serializeToString(doc),
    score = parseScore(changeTempo ? setNotationInstrument(xml, 'P1', 'alto') : xml),
    map = tempoMap(score),
    rate = 11025,
    offset = qToSeconds(3, map) - 0.1,
    frames = Math.ceil((qToSeconds(score.totalQ, map) - offset) * rate),
    samples = new Float32Array(frames);
  for (const note of soundingEvents(score)) {
    const start = qToSeconds(note.q, map) - offset,
      duration = (qToSeconds(note.q + note.duration, map) - qToSeconds(note.q, map)) * 0.85,
      freq = 440 * 2 ** ((note.midi! - 69) / 12);
    for (
      let i = Math.max(0, Math.round(start * rate));
      i < Math.min(frames, Math.round((start + duration) * rate));
      i++
    ) {
      const t = i / rate - start,
        envelope = Math.min(1, t / 0.015, (duration - t) / 0.02);
      samples[i] =
        0.2 *
        Math.max(0, envelope) *
        (Math.sin(2 * Math.PI * freq * t) + 0.15 * Math.sin(4 * Math.PI * freq * t));
    }
  }
  return { score, map, offset, rate, samples };
}
it.each([false, true])(
  'matches trimmed leading/trailing rests while retaining musical offsets, internal rests and tempo changes=%s',
  (changeTempo) => {
    const { score, map, offset, rate, samples } = trimmedExercise(changeTempo),
      features = audioFeatures(samples, rate, 0.12),
      alignment = alignToScore(score, features),
      error = (q: number) => secondsToQ(qToSeconds(q, alignment.anchors) + offset, map) - q;
    expect(alignment.anchors[0].q).toBe(0);
    expect(alignment.anchors[0].seconds).toBeLessThan(0);
    expect(alignment.anchors.at(-1)!.q).toBe(score.totalQ);
    // This bounds the reproduced entry shift, not the finer onset-quality target.
    expect(Math.abs(error(3))).toBeLessThan(0.25);
    for (const q of [12, 24, 28, 36, 44, 52, 58]) expect(Math.abs(error(q))).toBeLessThan(0.3);
    expect(assessAlignment(score, features, alignment, rate).decision).toBe('supported');
  },
);
it('restores score-clock leading and trailing silence when the trimmed source is conformed', () => {
  const { score, map, rate, samples } = trimmedExercise(),
    alignment = alignToScore(score, audioFeatures(samples, rate, 0.12)),
    duration = qToSeconds(score.totalQ, map),
    output = conformAudio(
      { sampleRate: rate, channels: [samples] },
      alignment.anchors,
      map,
      duration,
      score,
    ),
    channel = output.channels[0];
  const rms = (from: number, to: number) => {
    const part = channel.slice(Math.round(from * rate), Math.round(to * rate));
    return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length);
  };
  expect(channel).toHaveLength(Math.ceil(duration * rate));
  expect(channel.every(Number.isFinite)).toBe(true);
  expect(rms(0, 1.4)).toBe(0);
  expect(rms(2.1, 2.3)).toBeGreaterThan(0.04);
  expect(rms(duration - 2, duration - 0.2)).toBe(0);
});
it('rejects an all-rest reference instead of fabricating a pitched-content alignment', () => {
  const score = parseScore(demoXml());
  score.events = score.events.map((event) => ({ ...event, midi: null, writtenMidi: null }));
  expect(() => alignToScore(score, audioFeatures(new Float32Array(11025)))).toThrow(
    'no pitched notes',
  );
});
