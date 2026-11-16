import type { Clip, Selection, Track } from './types';
import { clipTimelineTime } from './clip-time';

// Keep the playback cursor inside the useful lane area, excluding sticky labels.
export function timelineFollowLeft(
  positionPixels: number,
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  labelWidth = 190,
): number {
  const visible = Math.max(1, viewportWidth - labelWidth);
  if (positionPixels >= scrollLeft && positionPixels <= scrollLeft + visible * 0.8)
    return scrollLeft;
  return Math.max(0, Math.min(contentWidth - viewportWidth, positionPixels - visible * 0.25));
}
// A timeline range belongs to one visible audio region, including its track offset.
export function clipSelection(track: Track, clip: Clip): Selection {
  const from = Math.max(0, clip.start + track.offset),
    to = Math.max(from, clip.end + track.offset);
  return { start: from, end: to, trackId: track.id, clipId: clip.id };
}

export function clipTrimBounds(track: Track, clip: Clip, sourceDuration?: number) {
  const previous = Math.max(
    -Infinity,
    ...track.clips.filter((c) => c.id !== clip.id && c.end <= clip.start + 1e-7).map((c) => c.end),
  );
  const next = Math.min(
    Infinity,
    ...track.clips
      .filter((c) => c.id !== clip.id && c.start >= clip.end - 1e-7)
      .map((c) => c.start),
  );
  let end = sourceDuration === undefined ? clip.end : clipTimelineTime(clip, sourceDuration);
  // AudioContext resampling can round the decoded source one frame shorter.
  // Keep the existing edge legal and retain a matching nominal map endpoint.
  if (sourceDuration !== undefined)
    for (const point of clip.timeMap || [])
      if (Math.abs(point.source - sourceDuration) < 1 / 8000) end = Math.max(end, point.time);
  return {
    start: Math.max(-track.offset, clipTimelineTime(clip, 0), previous),
    end: Math.min(next, Math.max(clip.end, end)),
  };
}
