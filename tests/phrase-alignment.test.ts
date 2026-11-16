// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { demoXml, demoPCM } from '../src/lib/demo';
import { parseScore, soundingEvents } from '../src/lib/score';
import { mono } from '../src/lib/audio';
import { proposePhraseAlignment, scorePhrases } from '../src/lib/phrase-alignment';
import { qToSeconds, secondsToQ, tempoMap } from '../src/lib/time';
import type { Anchor, Score } from '../src/lib/types';
const rate = 11025;
function render(score: Score, map: Anchor[]) {
  const samples = new Float32Array(Math.ceil((qToSeconds(score.totalQ, map) + 0.4) * rate));
  for (const note of soundingEvents(score)) {
    const start = qToSeconds(note.q, map),
      duration = (qToSeconds(note.q + note.duration, map) - start) * 0.85,
      frequency = 440 * 2 ** ((note.midi! - 69) / 12);
    for (
      let i = Math.max(0, Math.round(start * rate));
      i < Math.min(samples.length, Math.round((start + duration) * rate));
      i++
    ) {
      const time = i / rate - start,
        envelope = Math.min(1, time / 0.012, (duration - time) / 0.02);
      samples[i] =
        0.2 *
        Math.max(0, envelope) *
        (Math.sin(2 * Math.PI * frequency * time) +
          0.15 * Math.sin(4 * Math.PI * frequency * time));
    }
  }
  return samples;
}
function errors(score: Score, map: Anchor[], proposal: ReturnType<typeof proposePhraseAlignment>) {
  return proposal.chain.flatMap((phrase) =>
    phrase.points.map((point) => {
      const bar = [...score.route].reverse().find((bar) => bar.q <= point.q) || score.route[0],
        beat = 4 / score.measures[bar.measure].beatType;
      return Math.abs(secondsToQ(point.seconds, map) - point.q) / beat;
    }),
  );
}
it.each([0.5, 0.8, 1, 1.137, 1.5, 2])(
  'finds distributed note attacks at source duration ratio %s without using source length as musical evidence',
  (scale) => {
    const score = parseScore(demoXml()),
      truth = tempoMap(score).map((point) => ({ ...point, seconds: point.seconds * scale + 0.2 })),
      proposal = proposePhraseAlignment(score, render(score, truth), rate),
      measured = errors(score, truth, proposal);
    expect(proposal.chain).toHaveLength(4);
    expect(proposal.ambiguous).toBe(false);
    expect(Math.max(...measured)).toBeLessThan(1 / 16);
    expect(proposal.anchors[0].q).toBe(0);
  },
);
it('reports duplicate whole performances as ambiguous even when a tempo prior prefers one path', () => {
  const score = parseScore(demoXml()),
    one = mono(demoPCM().demo),
    twice = new Float32Array(one.length * 2);
  twice.set(one);
  twice.set(one, one.length);
  const proposal = proposePhraseAlignment(score, twice);
  expect(proposal.chain.length).toBeGreaterThan(0);
  expect(proposal.ambiguous).toBe(true);
  expect(proposal.alternatives.length).toBeGreaterThan(0);
});
it('does not fabricate phrases from melody-free backing, silence or deterministic noise', () => {
  const score = parseScore(demoXml()),
    backing = mono(demoPCM().backing),
    noise = new Float32Array(backing.length);
  let value = 1;
  for (let i = 0; i < noise.length; i++) {
    value = (value * 1664525 + 1013904223) >>> 0;
    noise[i] = (value / 2 ** 32 - 0.5) * 0.1;
  }
  for (const samples of [backing, new Float32Array(rate * 20), noise]) {
    const proposal = proposePhraseAlignment(score, samples);
    expect(proposal.chain).toHaveLength(0);
    expect(proposal.anchors).toHaveLength(0);
  }
});
it('retains pickup, 6/8 beat units, explicit Alto pitch and written tempo changes', () => {
  const pitches = [
      'D',
      'B',
      'G',
      'C',
      'E',
      'A',
      'F',
      'D',
      'G',
      'B',
      'C',
      'A',
      'E',
      'F',
      'B',
      'G',
      'D',
      'C',
      'F',
      'A',
      'B',
      'E',
      'D',
      'G',
    ],
    note = (step: string) =>
      `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration></note>`,
    xml = `<score-partwise><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list><part id="P1"><measure implicit="yes"><attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time><transpose><diatonic>-5</diatonic><chromatic>-9</chromatic></transpose></attributes><direction><sound tempo="92"/></direction>${note('E')}</measure>${Array.from(
      { length: 4 },
      (_, bar) =>
        `<measure number="${bar + 1}">${bar === 2 ? '<direction><sound tempo="73"/></direction>' : ''}${pitches
          .slice(bar * 6, bar * 6 + 6)
          .map(note)
          .join('')}</measure>`,
    ).join('')}</part></score-partwise>`,
    score = parseScore(xml),
    truth = tempoMap(score).map((point) => ({ ...point, seconds: point.seconds * 1.137 + 0.2 })),
    proposal = proposePhraseAlignment(score, render(score, truth), rate);
  expect(score.route[0].duration).toBe(0.5);
  expect(proposal.chain.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...errors(score, truth, proposal))).toBeLessThan(1 / 16);
  expect(proposal.phrases[0].attacks[0].midi).toEqual([67]);
});
it('keeps short isolated ending phrases review-only and unverified in the automatic strong map', () => {
  const score = parseScore(demoXml()),
    base = score.events[0],
    start = score.totalQ + 3;
  score.totalQ += 5;
  score.events.push(
    ...[60, 67, 72, 64].map((midi, index) => ({
      ...base,
      q: start + index * 0.5,
      duration: 0.5,
      midi,
      part: 'P1',
    })),
  );
  score.route.push({ id: 'tail', measure: 0, number: '17', q: start - 3, duration: 5, pass: 1 });
  const phrases = scorePhrases(score);
  expect(phrases.at(-1)?.reviewOnly).toBe(true);
  const truth = tempoMap(score),
    proposal = proposePhraseAlignment(score, render(score, truth), rate);
  expect(proposal.chain.every((phrase) => !phrase.reviewOnly)).toBe(true);
  expect(proposal.unverified.some((region) => region.from <= start && region.to >= start + 2)).toBe(
    true,
  );
});
