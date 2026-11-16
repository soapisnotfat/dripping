import type { Alignment, Anchor } from './types';
import { clone } from './types';
import { validateAnchors } from './time';

/** Correct a bounded span without refitting any automatic point outside it. */
export function pairWithinAlignment(
  alignment: Alignment,
  q: number,
  seconds: number,
  totalQ: number,
  sourceDuration: number,
): Alignment {
  if (
    !Number.isFinite(totalQ) ||
    totalQ <= 0 ||
    !Number.isFinite(sourceDuration) ||
    sourceDuration <= 0 ||
    !Number.isFinite(q) ||
    q < 0 ||
    q > totalQ ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds >= sourceDuration
  )
    throw Error(
      '配对需使用谱内位置与可试听的原音位置 / Pair a score position with audible source audio',
    );
  const next = clone(alignment),
    oldPairs = alignment.manualPairs || [],
    pairs = oldPairs
      .filter((point) => Math.abs(point.q - q) > 1e-7)
      .concat({ q, seconds })
      .sort((a, b) => a.q - b.q);
  if (pairs.length >= 2) validateAnchors(pairs);
  next.manualMode = 'local';
  next.manualPairs = pairs;
  next.manualAnchors = pairs.map((point) => point.q);
  next.method = 'manual';
  next.status = 'candidate';
  // A first pair is a pending audition cue. It cannot refit the whole curve or
  // discard automatic evidence before the user supplies a second boundary.
  if (pairs.length < 2) {
    next.manualAnchors = alignment.manualAnchors || [];
    return next;
  }
  const from = pairs[0].q,
    to = pairs.at(-1)!.q,
    external = alignment.anchors.filter((point) => point.q < from - 1e-7 || point.q > to + 1e-7),
    anchors = external.concat(pairs).sort((a, b) => a.q - b.q);
  try {
    validateAnchors(anchors);
  } catch {
    throw Error(
      '配对与区间外的对齐点冲突，请扩大配对范围或重新配对 / Pairing conflicts with anchors outside this span; widen the span or pair again',
    );
  }
  const sourceFor = (point: Anchor): NonNullable<Alignment['anchorSources']>[number] =>
    pairs.some((pair) => Math.abs(pair.q - point.q) < 1e-7)
      ? 'manual'
      : alignment.anchorSources?.[alignment.anchors.findIndex((old) => old.q === point.q)] ||
        'automatic';
  next.anchors = anchors;
  next.anchorSources = anchors.map(sourceFor);
  if (next.assessment) {
    next.assessment.decision = 'review';
    next.assessment.points = next.assessment.points.filter(
      (point) => point.q < from - 1e-7 || point.q > to + 1e-7,
    );
    next.assessment.reasons = [
      ...new Set([...next.assessment.reasons, 'manual-source-correction']),
    ];
  }
  return next;
}
