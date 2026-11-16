import type { Alignment, Anchor, Score } from './types';
import { clamp } from './types';
import { audioFeatures, scoreFeatures, dtw, type Features } from './alignment';
import {
  proposePhraseAlignment,
  sourceAttacks,
  sourceTimeIndex,
  type PhraseProposal,
  type SourceAttack,
} from './phrase-alignment';
import { soundingEvents } from './score';
import { qToSeconds, tempoMap, validateAnchors } from './time';

export type AlignmentProgress = {
  phase: 'features' | 'phrases' | 'refine' | 'verify';
  completed?: number;
  total?: number;
};
type Attack = { q: number; end: number; midi: number[] };
function noteAttacks(score: Score): Attack[] {
  const groups = new Map<number, Attack>();
  for (const note of soundingEvents(score)) {
    const previous = groups.get(note.q);
    if (previous) {
      previous.end = Math.max(previous.end, note.q + note.duration);
      previous.midi.push(note.midi!);
    } else groups.set(note.q, { q: note.q, end: note.q + note.duration, midi: [note.midi!] });
  }
  return [...groups.values()].sort((a, b) => a.q - b.q);
}
function ranges(notes: Attack[]) {
  const result: { from: number; to: number }[] = [];
  for (const note of notes) {
    const last = result.at(-1);
    if (last && note.q <= last.to + 1e-7) last.to = Math.max(last.to, note.end);
    else result.push({ from: note.q, to: note.end });
  }
  return result;
}
function slice(features: Features, from: number, to: number): { features: Features; from: number } {
  const a = clamp(Math.floor(from / features.hop), 0, features.frames - 1),
    b = clamp(Math.ceil(to / features.hop) + 1, a + 1, features.frames);
  return {
    from: a,
    features: {
      values: features.values.slice(a * 12, b * 12),
      energy: features.energy.slice(a, b),
      onsets: features.onsets?.slice(a, b),
      frames: b - a,
      hop: features.hop,
      duration: (b - a) * features.hop,
    },
  };
}
function mappedTime(
  path: [number, number][],
  refFrame: number,
  audioFrame: number,
  seconds: number,
  hop: number,
) {
  const at = seconds / hop - refFrame - 0.5;
  let low = 0,
    high = path.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (path[middle][0] <= at) low = middle;
    else high = middle;
  }
  const left = path[low],
    right = path[high],
    fraction = right[0] === left[0] ? 0 : (at - left[0]) / (right[0] - left[0]);
  return (audioFrame + left[1] + fraction * (right[1] - left[1]) + 0.5) * hop;
}
function support(note: Attack, event: SourceAttack) {
  const pcs = [...new Set(note.midi.map((midi) => ((Math.round(midi) % 12) + 12) % 12))];
  return clamp(pcs.reduce((sum, pc) => sum + event.pitch[pc], 0) / Math.sqrt(pcs.length), 0, 1);
}

/** Landmarks constrain the search; every pitched attack is then assessed. */
export function refineScorePhrases(
  score: Score,
  samples: Float32Array,
  sampleRate = 11025,
  sourceSampleRate = sampleRate,
  progress?: (value: AlignmentProgress) => void,
): {
  alignment: Alignment | null;
  landmarks: number;
  attacks: number;
  analyzed: number;
  proposal: PhraseProposal;
} {
  if (score.tempoMissing) throw Error('Enter the score tempo first');
  const map = tempoMap(score),
    notes = noteAttacks(score),
    duration = samples.length / sampleRate,
    hop = 0.025;
  if (qToSeconds(score.totalQ, map) / hop > 100000)
    throw Error('Score matching input is too long; use a shorter score');
  progress?.({ phase: 'features' });
  const events = sourceAttacks(samples, sampleRate);
  progress?.({ phase: 'phrases' });
  const proposal = proposePhraseAlignment(score, samples, sampleRate, events);
  if (!proposal.chain.length)
    return { alignment: null, landmarks: 0, attacks: notes.length, analyzed: 0, proposal };
  const controls = proposal.chain
      .flatMap((phrase) => [phrase.points[0], phrase.points.at(-1)!])
      .map((point) => ({ q: point.q, seconds: point.seconds }))
      .sort((a, b) => a.q - b.q),
    reference = scoreFeatures(score, hop),
    audio = audioFeatures(samples, sampleRate, hop),
    predicted = new Map<number, number>(controls.map((point) => [point.q, point.seconds])),
    analyzed = new Set(controls.map((point) => point.q)),
    firstQ = notes[0].q,
    lastQ = Math.max(...notes.map((note) => note.end));
  reference.onsets = new Float32Array(reference.frames);
  audio.onsets = new Float32Array(audio.frames);
  const pulse = (values: Float32Array, at: number) => {
    for (let offset = -1; offset <= 1; offset++) {
      const index = at + offset;
      if (index >= 0 && index < values.length)
        values[index] = Math.max(values[index], offset === 0 ? 1 : 0.5);
    }
  };
  for (const note of notes) pulse(reference.onsets, Math.floor(qToSeconds(note.q, map) / hop));
  for (const event of events) pulse(audio.onsets, Math.round(event.time / hop - 0.5));
  type Segment = {
    from: number;
    to: number;
    sourceFrom: number;
    sourceTo: number;
    start: boolean;
    end: boolean;
  };
  const segments: Segment[] = [];
  if (firstQ < controls[0].q)
    segments.push({
      from: firstQ,
      to: controls[0].q,
      sourceFrom: Math.max(
        0,
        controls[0].seconds - 2 * (qToSeconds(controls[0].q, map) - qToSeconds(firstQ, map)) - 0.1,
      ),
      sourceTo: controls[0].seconds,
      start: false,
      end: true,
    });
  for (let index = 1; index < controls.length; index++) {
    const a = controls[index - 1],
      b = controls[index];
    if (b.q > a.q)
      segments.push({
        from: a.q,
        to: b.q,
        sourceFrom: a.seconds,
        sourceTo: b.seconds,
        start: true,
        end: true,
      });
  }
  if (lastQ > controls.at(-1)!.q) {
    const last = controls.at(-1)!;
    segments.push({
      from: last.q,
      to: lastQ,
      sourceFrom: last.seconds,
      sourceTo: Math.min(
        duration,
        last.seconds + 2 * (qToSeconds(lastQ, map) - qToSeconds(last.q, map)) + 0.1,
      ),
      start: true,
      end: false,
    });
  }
  const query = [
    ...new Set([...notes.map((note) => note.q), ...score.tempo.map((change) => change.q), lastQ]),
  ].sort((a, b) => a - b);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index],
      target = query.filter((q) => q >= segment.from && q <= segment.to);
    progress?.({ phase: 'refine', completed: index, total: segments.length });
    const pitched = notes.some((note) => note.q <= segment.to && note.end > segment.from);
    if (!pitched) continue;
    const ref = slice(reference, qToSeconds(segment.from, map), qToSeconds(segment.to, map)),
      raw = slice(audio, segment.sourceFrom, segment.sourceTo);
    try {
      const result = dtw(ref.features, raw.features, false, {
        start: segment.start,
        end: segment.end,
        onsetWeight: 0.35,
      });
      for (const q of target) {
        if (!predicted.has(q))
          predicted.set(q, mappedTime(result.path, ref.from, raw.from, qToSeconds(q, map), hop));
        analyzed.add(q);
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/No continuous alignment|Alignment input is too long/.test(error.message)
      )
        throw error; /* Bounded search failure stays unassessed, not rejected content. */
    }
  }
  progress?.({ phase: 'verify' });
  const points: NonNullable<Alignment['assessment']>['points'] = [],
    unsupported = new Set<number>(),
    sourceByQ = new Map(predicted),
    controlQ = new Set(controls.map((point) => point.q));
  for (const note of notes) {
    const expected = predicted.get(note.q);
    if (expected === undefined) continue;
    const bar = [...score.route].reverse().find((bar) => bar.q <= note.q) || score.route[0],
      beat = 4 / score.measures[bar.measure].beatType,
      tolerance = Math.max(
        0.045,
        Math.min(0.16, (qToSeconds(note.q + beat, map) - qToSeconds(note.q, map)) * 0.25),
      ),
      before = [...controls].reverse().find((point) => point.q < note.q),
      after = controls.find((point) => point.q > note.q);
    let best: SourceAttack | undefined,
      value = -Infinity,
      pitch = 0;
    for (
      let index = sourceTimeIndex(events, expected - tolerance);
      index < events.length && events[index].time <= expected + tolerance;
      index++
    ) {
      const event = events[index];
      if ((before && event.time <= before.seconds) || (after && event.time >= after.seconds))
        continue;
      const match = support(note, event),
        score = 0.65 * match + 0.35 * (1 - Math.abs(event.time - expected) / tolerance);
      if (match >= 0.5 && score > value) {
        best = event;
        value = score;
        pitch = match;
      }
    }
    const seconds = controlQ.has(note.q) ? expected : (best?.time ?? expected);
    if (!best || pitch < 0.55) unsupported.add(note.q);
    else sourceByQ.set(note.q, seconds);
    points.push({
      q: note.q,
      sourceSample: clamp(
        Math.round(seconds * sourceSampleRate),
        0,
        Math.max(0, Math.ceil(duration * sourceSampleRate) - 1),
      ),
      midi: note.midi,
      support: pitch,
      attack: best?.strength ?? 0,
    });
  }
  const sources = [...sourceByQ]
    .filter(([q]) => q >= firstQ && q <= lastQ)
    .sort((a, b) => a[0] - b[0]);
  let anchors: Anchor[] = sources.map(([q, seconds]) => ({ q, seconds }));
  if (anchors[0].q > 0)
    anchors.unshift({
      q: 0,
      seconds:
        anchors[0].seconds +
        (qToSeconds(0, map) - qToSeconds(anchors[0].q, map)) * proposal.chain[0].scale,
    });
  if (anchors.at(-1)!.q < score.totalQ) {
    const last = anchors.at(-1)!;
    anchors.push({
      q: score.totalQ,
      seconds:
        last.seconds +
        (qToSeconds(score.totalQ, map) - qToSeconds(last.q, map)) * proposal.chain.at(-1)!.scale,
    });
  }
  let mapConflict = false;
  try {
    validateAnchors(anchors);
  } catch {
    anchors = proposal.anchors;
    mapConflict = true;
    for (const note of notes)
      if (analyzed.has(note.q) && !controlQ.has(note.q)) unsupported.add(note.q);
  }
  const unverified = ranges(notes.filter((note) => unsupported.has(note.q))),
    unassessed = ranges(notes.filter((note) => !analyzed.has(note.q))),
    reasons: string[] = [];
  if (mapConflict) reasons.push('nonmonotone-refinement');
  if (proposal.ambiguous) reasons.push('ambiguous-phrase-chain');
  if (unverified.length) reasons.push('unsupported-score-notes');
  if (unassessed.length) reasons.push('not-fully-analyzed');
  if (notes.length < 6) reasons.push('too-few-note-attacks');
  const supportedFraction =
      notes.filter((note) => analyzed.has(note.q) && !unsupported.has(note.q)).length /
      Math.max(1, notes.length),
    decision = proposal.ambiguous ? 'ambiguous' : reasons.length ? 'review' : 'supported',
    bounded =
      points.length <= 128
        ? points
        : Array.from(
            { length: 128 },
            (_, index) => points[Math.round((index * (points.length - 1)) / 127)],
          );
  const alignment: Alignment = {
    anchors,
    anchorSources: anchors.map((point) =>
      controlQ.has(point.q) || notes.some((note) => note.q === point.q)
        ? 'automatic'
        : 'extrapolated',
    ),
    status: 'candidate',
    method: 'score-phrases',
    manualAnchors: [],
    warnings: [],
    assessment: {
      basis: 'score-notes',
      decision,
      supportedFraction,
      reasons,
      unverified,
      unassessed,
      points: bounded,
    },
  };
  return {
    alignment,
    landmarks: proposal.chain.length,
    attacks: notes.length,
    analyzed: notes.filter((note) => analyzed.has(note.q)).length,
    proposal,
  };
}
