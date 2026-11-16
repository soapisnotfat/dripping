import type { Alignment, Score } from './types';
import type { Features } from './alignment';
import { soundingEvents } from './score';
import { qToSeconds, beatGrid } from './time';
import { clamp } from './types';

export type MatchEvidence = {
  q: number;
  sourceSample: number;
  midi: number[];
  support: number;
  attack: number;
};
export type MatchAssessment = {
  basis: 'score-notes' | 'shared-accompaniment';
  decision: 'supported' | 'review' | 'insufficient' | 'ambiguous';
  supportedFraction: number;
  reasons: string[];
  points: MatchEvidence[];
};
function frameAttack(audio: Features, frame: number) {
  if (frame < 1 || frame >= audio.frames) return 0;
  let rise = 0;
  for (let pc = 0; pc < 12; pc++)
    rise += Math.max(0, audio.values[frame * 12 + pc] - audio.values[(frame - 1) * 12 + pc]) ** 2;
  return Math.max(
    Math.sqrt(rise),
    Math.max(0, audio.energy[frame] - audio.energy[frame - 1]) /
      Math.max(0.00005, audio.energy[frame]),
  );
}
function repeatedPrefix(
  attacks: [number, number[]][],
  audio: Features,
  alignment: Alignment,
): boolean {
  const length = 8;
  if (attacks.length < length) return false;
  const prefix = attacks.slice(0, length),
    pcs = prefix.map(([, midi]) =>
      [...new Set(midi.map((pitch) => ((Math.round(pitch) % 12) + 12) % 12))].sort((a, b) => a - b),
    ),
    times = prefix.map(([q]) => qToSeconds(q, alignment.anchors)),
    span = times[length - 1] - times[0];
  if (span < audio.hop * 3) return false;
  const pattern = pcs.map((value) => value.join(',')).join(';');
  let expected = 0;
  for (let i = 0; i <= attacks.length - length; i++) {
    const candidate = attacks.slice(i, i + length),
      shape = candidate
        .map(([, midi]) =>
          [...new Set(midi.map((pitch) => ((Math.round(pitch) % 12) + 12) % 12))]
            .sort((a, b) => a - b)
            .join(','),
        )
        .join(';');
    if (
      shape === pattern &&
      candidate.every(
        ([q], index) => Math.abs(q - candidate[0][0] - (prefix[index][0] - prefix[0][0])) < 1e-5,
      )
    )
      expected++;
  }
  const values = new Float32Array(audio.frames);
  for (let start = 1; start < audio.frames; start++) {
    if (frameAttack(audio, start) < 0.12) continue;
    let best = 0;
    for (const scale of [0.85, 1, 1.15]) {
      let sum = 0,
        valid = true;
      for (let i = 0; i < length; i++) {
        const at = start + Math.round(((times[i] - times[0]) * scale) / audio.hop);
        let note = 0;
        for (
          let frame = Math.max(0, at - 1);
          frame <= Math.min(audio.frames - 1, at + 1);
          frame++
        ) {
          let dot = 0;
          for (const pc of pcs[i]) dot += audio.values[frame * 12 + pc] / Math.sqrt(pcs[i].length);
          if (dot >= 0.65 && frameAttack(audio, frame) >= 0.12)
            note = Math.max(
              note,
              0.75 * clamp(dot, 0, 1) + 0.25 * clamp(frameAttack(audio, frame), 0, 1),
            );
        }
        if (note < 0.45) {
          valid = false;
          break;
        }
        sum += note;
      }
      if (valid) best = Math.max(best, sum / length);
    }
    values[start] = best;
  }
  const candidates = Array.from(values, (value, frame) => ({ value, frame }))
      .filter(
        ({ value, frame }) =>
          value >= 0.65 && value >= values[frame - 1] && value > values[frame + 1],
      )
      .sort((a, b) => b.value - a.value),
    peaks: number[] = [];
  for (const candidate of candidates)
    if (peaks.every((frame) => Math.abs(frame - candidate.frame) * audio.hop > span * 0.75))
      peaks.push(candidate.frame);
  return peaks.length > expected;
}
export function assessAlignment(
  score: Score,
  audio: Features,
  alignment: Alignment,
  sampleRate: number,
): MatchAssessment {
  const notes = soundingEvents(score),
    groups = new Map<number, number[]>(),
    ends = new Map<number, number>();
  for (const note of notes) {
    if (note.midi === null || note.duration <= 0) continue;
    groups.set(note.q, [...(groups.get(note.q) || []), note.midi]);
    ends.set(note.q, Math.max(ends.get(note.q) ?? 0, note.q + note.duration));
  }
  const attacks = [...groups].sort((a, b) => a[0] - b[0]),
    points: MatchEvidence[] = [],
    peak = Math.max(...audio.energy),
    threshold = Math.max(0.00005, peak * 0.012);
  for (const [q, midi] of attacks) {
    const seconds = qToSeconds(q, alignment.anchors),
      center = Math.floor(seconds / audio.hop),
      pcs = [...new Set(midi.map((pitch) => ((Math.round(pitch) % 12) + 12) % 12))];
    let support = 0,
      attack = 0,
      best = center;
    for (
      let frame = Math.max(0, center - 1);
      frame <= Math.min(audio.frames - 1, center + 1);
      frame++
    ) {
      if (audio.energy[frame] < threshold) continue;
      let dot = 0;
      for (const pc of pcs) dot += audio.values[frame * 12 + pc] / Math.sqrt(pcs.length);
      const onset = frameAttack(audio, frame);
      if (dot * Math.max(0.1, onset) > support * Math.max(0.1, attack)) {
        support = dot;
        attack = onset;
        best = frame;
      }
    }
    points.push({
      q,
      sourceSample: Math.max(
        0,
        Math.min(
          Math.ceil(audio.duration * sampleRate) - 1,
          Math.round((best + 0.5) * audio.hop * sampleRate),
        ),
      ),
      midi,
      support: clamp(support, 0, 1),
      attack: clamp(attack, 0, 1),
    });
  }
  const supported = (point: MatchEvidence) => point.support >= 0.55 && point.attack >= 0.12,
    ratio = (input: MatchEvidence[]) => input.filter(supported).length / Math.max(1, input.length),
    supportedFraction = ratio(points),
    reasons: string[] = [];
  if (!points.length || peak < 0.00005)
    return {
      basis: 'score-notes',
      decision: 'insufficient',
      supportedFraction,
      reasons: ['no-note-evidence'],
      points,
    };
  const section = Math.max(2, Math.ceil(points.length / 4));
  if (points.length < 6) reasons.push('too-few-note-attacks');
  if (
    points.some((point, index) => index > 0 && point.sourceSample <= points[index - 1].sourceSample)
  )
    reasons.push('unresolved-note-entries');
  if (supportedFraction < 0.6) reasons.push('weak-note-attacks');
  if (ratio(points.slice(0, section)) < 0.5) reasons.push('weak-opening');
  if (ratio(points.slice(-section)) < 0.5) reasons.push('weak-ending');
  let previousEnd = -Infinity;
  const entries: number[] = [];
  for (let index = 0; index < attacks.length; index++) {
    const q = attacks[index][0],
      bar = [...score.route].reverse().find((bar) => bar.q <= q) || score.route[0],
      beat = 4 / score.measures[bar.measure].beatType;
    if (index === 0 || q - previousEnd >= 2 * beat - 1e-7) entries.push(index);
    previousEnd = Math.max(previousEnd, ends.get(q)!);
  }
  const weakEntries = entries.filter((at, index) =>
    points
      .slice(at, Math.min(entries[index + 1] ?? points.length, at + 2))
      .some((point) => !supported(point)),
  );
  if (weakEntries.length) reasons.push('weak-phrase-entry');
  const repeated = repeatedPrefix(attacks, audio, alignment);
  if (repeated) reasons.push('repeated-prefix-candidates');
  if ((alignment.cost ?? 0) > 0.55) reasons.push('weak-pitch-match');
  if ((alignment.coverage ?? 1) < 0.65) reasons.push('large-timing-difference');
  return {
    basis: 'score-notes',
    decision: reasons.length
      ? supportedFraction < 0.4
        ? 'insufficient'
        : weakEntries.length || repeated
          ? 'ambiguous'
          : 'review'
      : 'supported',
    supportedFraction,
    reasons,
    points,
  };
}

export function assessDemoBridge(
  score: Score,
  demo: Features,
  demoMap: Alignment['anchors'],
  audio: Features,
  alignment: Alignment,
  sampleRate: number,
): MatchAssessment {
  const grid = beatGrid(score),
    points: MatchEvidence[] = [],
    peak = Math.max(...audio.energy),
    profiles: number[][] = [];
  for (const q of grid.slice(0, -1)) {
    const a = Math.round(qToSeconds(q, demoMap) / demo.hop - 0.5),
      b = Math.round(qToSeconds(q, alignment.anchors) / audio.hop - 0.5);
    let support = 0;
    if (
      a >= 0 &&
      a < demo.frames &&
      b >= 0 &&
      b < audio.frames &&
      audio.energy[b] > Math.max(0.00005, peak * 0.012)
    ) {
      const left = demo.bass || demo.values,
        right = audio.bass || audio.values;
      profiles.push(Array.from(left.slice(a * 12, a * 12 + 12)));
      for (let pc = 0; pc < 12; pc++) support += left[a * 12 + pc] * right[b * 12 + pc];
    }
    points.push({
      q,
      sourceSample: Math.max(
        0,
        Math.min(
          Math.ceil(audio.duration * sampleRate) - 1,
          Math.round((b + 0.5) * audio.hop * sampleRate),
        ),
      ),
      midi: [],
      support: clamp(support, 0, 1),
      attack: 0,
    });
  }
  const ratio = (subset: MatchEvidence[]) =>
      subset.filter((point) => point.support >= 0.75).length / Math.max(1, subset.length),
    supportedFraction = ratio(points),
    reasons: string[] = [];
  if (supportedFraction < 0.7) reasons.push('weak-shared-accompaniment');
  const count = Math.max(2, Math.ceil(points.length / 4));
  if (ratio(points.slice(0, count)) < 0.5 || ratio(points.slice(-count)) < 0.5)
    reasons.push('weak-bridge-boundaries');
  const classes = new Set(profiles.map((profile) => profile.indexOf(Math.max(...profile))));
  if (points.length < 8 || classes.size < 3) reasons.push('low-shared-structure');
  if ((alignment.cost ?? 0) > 0.5) reasons.push('weak-shared-accompaniment');
  if (!reasons.length) {
    const all = grid.slice(0, -1),
      queries =
        all.length <= 64
          ? all
          : Array.from(
              { length: 64 },
              (_, index) => all[Math.round((index * (all.length - 1)) / 63)],
            ),
      left = demo.bass || demo.values,
      right = audio.bass || audio.values;
    const sample = queries.map((q) => ({
        demo: Math.round(qToSeconds(q, demoMap) / demo.hop - 0.5),
        source: qToSeconds(q, alignment.anchors),
      })),
      from = Math.min(...sample.map((point) => point.source)),
      to = Math.max(...sample.map((point) => point.source)),
      barSpan = Math.max(
        audio.hop * 4,
        ...score.route
          .slice(0, 4)
          .map(
            (bar) =>
              qToSeconds(bar.q + bar.duration, alignment.anchors) -
              qToSeconds(bar.q, alignment.anchors),
          ),
      ),
      block = Math.max(2, Math.ceil(sample.length / 4));
    // An extra whole performance/section must not be selected merely because
    // its shared pitch profile gives the first minimum. Compare complete,
    // well-separated alternatives, keeping the score route unchanged.
    for (
      let shift = Math.ceil(-from / audio.hop);
      shift <= Math.floor((audio.duration - to) / audio.hop);
      shift++
    ) {
      const offset = shift * audio.hop;
      if (Math.abs(offset) < barSpan) continue;
      const matches = sample.map((point) => {
        const b = Math.round((point.source + offset) / audio.hop - 0.5);
        if (
          point.demo < 0 ||
          point.demo >= demo.frames ||
          b < 0 ||
          b >= audio.frames ||
          audio.energy[b] <= Math.max(0.00005, peak * 0.012)
        )
          return false;
        let dot = 0;
        for (let pc = 0; pc < 12; pc++) dot += left[point.demo * 12 + pc] * right[b * 12 + pc];
        return dot >= 0.75;
      });
      const share = (rows: boolean[]) => rows.filter(Boolean).length / Math.max(1, rows.length);
      if (
        share(matches) >= 0.7 &&
        share(matches.slice(0, block)) >= 0.5 &&
        share(matches.slice(-block)) >= 0.5
      ) {
        reasons.push('ambiguous-shared-passages');
        break;
      }
    }
  }
  return {
    basis: 'shared-accompaniment',
    decision: reasons.includes('ambiguous-shared-passages')
      ? 'ambiguous'
      : reasons.length
        ? 'insufficient'
        : 'supported',
    supportedFraction,
    reasons,
    points,
  };
}
