import type { Score, Anchor } from './types';
import { clamp } from './types';
import { soundingEvents } from './score';
import { audioFeatures } from './alignment';
import { qToSeconds, tempoMap, validateAnchors } from './time';

export type PhraseAttack = { q: number; midi: number[]; time: number };
export type ScorePhrase = {
  id: number;
  attacks: PhraseAttack[];
  from: number;
  to: number;
  reviewOnly: boolean;
};
export type SourceAttack = { time: number; strength: number; pitch: number[] };
export type PhraseCandidate = {
  phrase: number;
  from: number;
  to: number;
  sourceFrom: number;
  sourceTo: number;
  score: number;
  scale: number;
  reviewOnly: boolean;
  points: { q: number; seconds: number; support: number }[];
};
export type PhraseProposal = {
  phrases: ScorePhrase[];
  candidates: PhraseCandidate[][];
  chain: PhraseCandidate[];
  anchors: Anchor[];
  alternatives: PhraseCandidate[][];
  ambiguous: boolean;
  unverified: { from: number; to: number }[];
};

export function scorePhrases(score: Score): ScorePhrase[] {
  const map = tempoMap(score),
    groups = new Map<number, number[]>(),
    ends = new Map<number, number>();
  for (const note of soundingEvents(score)) {
    groups.set(note.q, [...(groups.get(note.q) || []), note.midi!]);
    ends.set(note.q, Math.max(ends.get(note.q) || 0, note.q + note.duration));
  }
  const attacks = [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([q, midi]) => ({ q, midi: [...new Set(midi)], time: qToSeconds(q, map) }));
  const starts = new Set<number>([0]);
  let cursor = 0;
  for (const bar of score.route) {
    while (cursor < attacks.length && attacks[cursor].q < bar.q - 1e-7) cursor++;
    if (cursor < attacks.length && attacks[cursor].q < bar.q + bar.duration) starts.add(cursor);
  }
  const phrases: ScorePhrase[] = [];
  let previousEnd = -1;
  for (const index of [...starts].sort((a, b) => a - b)) {
    if (index < previousEnd) continue;
    const notes: PhraseAttack[] = [];
    let precedingEnd = -Infinity;
    for (const attack of attacks.slice(index, index + 10)) {
      const bar = [...score.route].reverse().find((bar) => bar.q <= attack.q) || score.route[0],
        beat = 4 / score.measures[bar.measure].beatType;
      if (notes.length && attack.q - precedingEnd >= 2 * beat) break;
      notes.push(attack);
      precedingEnd = Math.max(precedingEnd, ends.get(attack.q)!);
    }
    if (notes.length < 4) continue;
    const pitchClasses = new Set(
        notes.flatMap((note) => note.midi.map((pitch) => ((Math.round(pitch) % 12) + 12) % 12)),
      ),
      span = notes.at(-1)!.q - notes[0].q;
    if (pitchClasses.size < 3 || span < 1 || span > 16) continue;
    phrases.push({
      id: phrases.length,
      attacks: notes,
      from: notes[0].q,
      to: notes.at(-1)!.q,
      reviewOnly: notes.length < 6 || span < 2,
    });
    previousEnd = index + notes.length;
  }
  return phrases.length <= 32
    ? phrases
    : Array.from(
        { length: 32 },
        (_, index) => phrases[Math.round((index * (phrases.length - 1)) / 31)],
      );
}

export function sourceAttacks(samples: Float32Array, sampleRate = 11025): SourceAttack[] {
  const hop = 0.01,
    window = Math.round(sampleRate * 0.02),
    frames = Math.ceil(samples.length / sampleRate / hop),
    energy = new Float32Array(frames),
    flux = new Float32Array(frames),
    pitch = audioFeatures(samples, sampleRate, 0.025);
  let power = 0,
    left = 0,
    right = 0;
  for (let frame = 0; frame < frames; frame++) {
    const center = Math.round(frame * hop * sampleRate),
      a = Math.max(0, center - Math.floor(window / 2)),
      b = Math.min(samples.length, center + Math.ceil(window / 2));
    while (right < b) {
      power += samples[right] ** 2;
      right++;
    }
    while (left < a) {
      power -= samples[left] ** 2;
      left++;
    }
    energy[frame] = Math.sqrt(Math.max(0, power) / Math.max(1, b - a));
    if (frame) flux[frame] = Math.max(0, energy[frame] - energy[frame - 1]);
  }
  const peak = energy.reduce((a, b) => Math.max(a, b), 0),
    fluxPeak = flux.reduce((a, b) => Math.max(a, b), 0),
    events: SourceAttack[] = [];
  for (let frame = 1; frame < frames - 1; frame++) {
    if (
      flux[frame] < Math.max(0.00003, fluxPeak * 0.025) ||
      flux[frame] < flux[frame - 1] ||
      flux[frame] <= flux[frame + 1] ||
      energy[frame] < peak * 0.008
    )
      continue;
    const time = frame * hop,
      at = clamp(Math.round((time + 0.03) / pitch.hop - 0.5), 0, pitch.frames - 1),
      values = Array.from(pitch.values.slice(at * 12, at * 12 + 12)),
      strength = clamp(flux[frame] / Math.max(0.0001, energy[frame]), 0, 1),
      last = events.at(-1);
    if (last && time - last.time < 0.035) {
      if (strength > last.strength) events[events.length - 1] = { time, strength, pitch: values };
      continue;
    }
    events.push({ time, strength, pitch: values });
  }
  return events;
}
function similarity(note: PhraseAttack, attack: SourceAttack) {
  const pcs = [...new Set(note.midi.map((midi) => ((Math.round(midi) % 12) + 12) % 12))];
  return clamp(pcs.reduce((sum, pc) => sum + attack.pitch[pc], 0) / Math.sqrt(pcs.length), 0, 1);
}
export function sourceTimeIndex(events: SourceAttack[], time: number) {
  let low = 0,
    high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function phraseCandidates(phrase: ScorePhrase, events: SourceAttack[]): PhraseCandidate[] {
  const candidates: PhraseCandidate[] = [],
    notes = phrase.attacks,
    referenceSpan = notes.at(-1)!.time - notes[0].time;
  for (let start = 0; start < events.length; start++) {
    if (similarity(notes[0], events[start]) < 0.55) continue;
    let best: PhraseCandidate | undefined;
    const scales: number[] = [],
      first = sourceTimeIndex(events, events[start].time + referenceSpan * 0.5 - 0.02),
      last = sourceTimeIndex(events, events[start].time + referenceSpan * 2 + 0.02);
    for (let at = Math.max(start + 1, first); at < last; at++)
      if (similarity(notes.at(-1)!, events[at]) >= 0.55)
        scales.push((events[at].time - events[start].time) / referenceSpan);
    for (const scale of scales) {
      const points = [
        {
          q: notes[0].q,
          seconds: events[start].time,
          support: similarity(notes[0], events[start]),
        },
      ];
      let sum = points[0].support,
        previous = start,
        missed = 0;
      for (const note of notes.slice(1)) {
        const expected = events[start].time + (note.time - notes[0].time) * scale,
          tolerance = Math.min(0.2, Math.max(0.065, referenceSpan * scale * 0.025));
        let value = 0,
          chosen = -1,
          support = 0;
        for (
          let at = Math.max(previous + 1, sourceTimeIndex(events, expected - tolerance));
          at < events.length;
          at++
        ) {
          const event = events[at];
          if (event.time > expected + tolerance) break;
          const match = similarity(note, event),
            score = 0.8 * match + 0.2 * (1 - Math.abs(event.time - expected) / tolerance);
          if (match >= 0.5 && score > value) {
            value = score;
            support = match;
            chosen = at;
          }
        }
        if (chosen < 0) {
          missed++;
          continue;
        }
        previous = chosen;
        sum += value;
        points.push({ q: note.q, seconds: events[chosen].time, support });
      }
      const score = sum / notes.length;
      if (missed > 1 || points.at(-1)!.q !== notes.at(-1)!.q || score < 0.65) continue;
      const result = {
        phrase: phrase.id,
        from: phrase.from,
        to: phrase.to,
        sourceFrom: points[0].seconds,
        sourceTo: points.at(-1)!.seconds,
        score,
        scale,
        reviewOnly: phrase.reviewOnly,
        points,
      };
      if (!best || result.score > best.score) best = result;
    }
    if (best) candidates.push(best);
  }
  const kept: PhraseCandidate[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score))
    if (
      kept.every(
        (other) =>
          Math.abs(other.sourceFrom - candidate.sourceFrom) >
          Math.max(0.5, (candidate.sourceTo - candidate.sourceFrom) * 0.5),
      )
    ) {
      kept.push(candidate);
      if (kept.length === 4) break;
    }
  return kept;
}
export function proposePhraseAlignment(
  score: Score,
  samples: Float32Array,
  sampleRate = 11025,
  precomputed?: SourceAttack[],
): PhraseProposal {
  if (score.tempoMissing) throw Error('Enter the score tempo first');
  const phrases = scorePhrases(score),
    events = precomputed || sourceAttacks(samples, sampleRate);
  const candidates = phrases.map((phrase) => phraseCandidates(phrase, events)),
    nodes = candidates
      .flat()
      .filter((candidate) => !candidate.reviewOnly)
      .sort((a, b) => a.from - b.from || a.sourceFrom - b.sourceFrom),
    map = tempoMap(score),
    paths: { value: number; indices: number[] }[][] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index],
      options = [{ value: node.score, indices: [index] }];
    for (let before = 0; before < index; before++) {
      const previous = nodes[before];
      if (previous.to >= node.from || previous.sourceTo >= node.sourceFrom) continue;
      const elapsed = qToSeconds(node.from, map) - qToSeconds(previous.from, map),
        ratio = (node.sourceFrom - previous.sourceFrom) / elapsed;
      if (ratio < 0.5 - 0.02 / elapsed || ratio > 2 + 0.02 / elapsed) continue;
      const penalty = 0.2 * Math.abs(Math.log(ratio / Math.sqrt(previous.scale * node.scale)));
      for (const path of paths[before])
        options.push({
          value: path.value + node.score - penalty,
          indices: [...path.indices, index],
        });
    }
    paths[index] = options.sort((a, b) => b.value - a.value).slice(0, 4);
  }
  const ranked = paths.flat().sort((a, b) => b.value - a.value),
    best = ranked[0],
    chain = best ? best.indices.map((index) => nodes[index]) : [],
    alternatives: PhraseCandidate[][] = [];
  const content = (path: PhraseCandidate[]) =>
    path.reduce((sum, node) => sum + node.score, 0) / Math.max(1, path.length);
  for (const path of ranked.slice(1)) {
    const other = path.indices.map((index) => nodes[index]);
    if (
      other.length === chain.length &&
      other.every((node, index) => node.phrase === chain[index].phrase) &&
      Math.abs(content(other) - content(chain)) < 0.03
    ) {
      alternatives.push(other);
      if (alternatives.length === 3) break;
    }
  }
  const ambiguous = alternatives.length > 0;
  const points = chain
      .flatMap((node) => node.points)
      .map((point) => ({ q: point.q, seconds: point.seconds })),
    anchors: Anchor[] = [],
    unverified: { from: number; to: number }[] = [],
    matched = new Set(points.map((point) => point.q));
  for (const note of soundingEvents(score).filter((note) => !matched.has(note.q))) {
    const last = unverified.at(-1),
      to = note.q + note.duration;
    if (last && note.q <= last.to + 1e-7) last.to = Math.max(last.to, to);
    else unverified.push({ from: note.q, to });
  }
  if (points.length >= 2) {
    anchors.push(...points);
    if (anchors[0].q > 0)
      anchors.unshift({
        q: 0,
        seconds:
          anchors[0].seconds +
          (qToSeconds(0, map) - qToSeconds(anchors[0].q, map)) * chain[0].scale,
      });
    if (anchors.at(-1)!.q < score.totalQ) {
      const last = anchors.at(-1)!;
      anchors.push({
        q: score.totalQ,
        seconds:
          last.seconds +
          (qToSeconds(score.totalQ, map) - qToSeconds(last.q, map)) * chain.at(-1)!.scale,
      });
    }
    validateAnchors(anchors);
  }
  return { phrases, candidates, chain, anchors, alternatives, ambiguous, unverified };
}
