// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { demoXml, demoPCM } from '../src/lib/demo';
import { parseScore } from '../src/lib/score';
import { mono } from '../src/lib/audio';
import { refineScorePhrases } from '../src/lib/phrase-refinement';
import { secondsToQ, tempoMap } from '../src/lib/time';
it('refines and assesses all attacks of a complete known demonstration beyond sampled landmarks', () => {
  const score = parseScore(demoXml()),
    progress: string[] = [],
    result = refineScorePhrases(score, mono(demoPCM().demo), 11025, 48000, (value) =>
      progress.push(value.phase),
    ),
    evidence = result.alignment!.assessment!,
    map = tempoMap(score);
  expect(result.landmarks).toBe(4);
  expect(result.attacks).toBe(51);
  expect(result.analyzed).toBe(result.attacks);
  expect(evidence).toMatchObject({ decision: 'supported', unverified: [], unassessed: [] });
  expect(progress).toEqual(expect.arrayContaining(['features', 'phrases', 'refine', 'verify']));
  const errors = evidence.points.map((point) =>
    Math.abs(secondsToQ(point.sourceSample / 48000 - 0.55, map) - point.q),
  );
  expect(Math.max(...errors)).toBeLessThan(1 / 16);
  expect(evidence.points.some((point) => point.q === 12)).toBe(true);
  expect(result.alignment!.method).toBe('score-phrases');
});
it('refuses unrelated backing and preserves ambiguity across duplicate complete performances', () => {
  const score = parseScore(demoXml()),
    audio = demoPCM();
  expect(refineScorePhrases(score, mono(audio.backing)).alignment).toBeNull();
  const one = mono(audio.demo),
    twice = new Float32Array(one.length * 2);
  twice.set(one);
  twice.set(one, one.length);
  const result = refineScorePhrases(score, twice);
  expect(result.alignment!.assessment!.decision).toBe('ambiguous');
  expect(result.alignment!.assessment!.reasons).toContain('ambiguous-phrase-chain');
});
it('requires explicit score tempo before landmark or full-content analysis', () => {
  expect(() =>
    refineScorePhrases({ ...parseScore(demoXml()), tempoMissing: true }, new Float32Array(11025)),
  ).toThrow('tempo');
});
it('assesses every attack of a long score when landmark selection reaches its 32-phrase cap', () => {
  const choices = [60, 62, 64, 65, 67, 69, 71, 72],
    names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  let seed = 9;
  const pitches = Array.from({ length: 480 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return choices[(seed >>> 16) % choices.length];
    }),
    xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from(
      { length: 120 },
      (_, bar) =>
        `<measure number="${bar + 1}">${bar === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="180"/></direction>' : ''}${pitches
          .slice(bar * 4, bar * 4 + 4)
          .map(
            (midi) =>
              `<note><pitch><step>${names[midi % 12]}</step><octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>1</duration></note>`,
          )
          .join('')}</measure>`,
    ).join('')}</part></score-partwise>`,
    score = parseScore(xml),
    rate = 11025,
    samples = new Float32Array(Math.ceil(160.6 * rate));
  for (let q = 0; q < pitches.length; q++) {
    const start = 0.2 + q / 3,
      duration = 0.28,
      frequency = 440 * 2 ** ((pitches[q] - 69) / 12);
    for (let i = Math.round(start * rate); i < (start + duration) * rate; i++) {
      const time = i / rate - start,
        envelope = Math.min(1, time / 0.012, (duration - time) / 0.02);
      samples[i] = 0.2 * Math.max(0, envelope) * Math.sin(2 * Math.PI * frequency * time);
    }
  }
  const result = refineScorePhrases(score, samples);
  expect(result.proposal.phrases).toHaveLength(32);
  expect(result.analyzed).toBe(480);
  expect(result.alignment!.assessment!.decision).toBe('supported');
  expect(result.alignment!.assessment!.unverified).toEqual([]);
  expect(result.alignment!.assessment!.unassessed).toEqual([]);
});
