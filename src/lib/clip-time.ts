import type { Clip } from './types';

function interpolate(points: NonNullable<Clip['timeMap']>, value: number, inverse = false) {
  const x = inverse ? 'source' : 'time',
    y = inverse ? 'time' : 'source';
  let low = 0,
    high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (points[middle][x] <= value) low = middle;
    else high = middle;
  }
  const a = points[low],
    b = points[high];
  return a[y] + ((value - a[x]) / (b[x] - a[x])) * (b[y] - a[y]);
}
export const clipSourceTime = (clip: Clip, time: number) =>
  clip.timeMap
    ? interpolate(clip.timeMap, time)
    : clip.sourceStart + (time - clip.start) * clip.rate;
export const clipTimelineTime = (clip: Clip, source: number) =>
  clip.timeMap
    ? interpolate(clip.timeMap, source, true)
    : clip.start + (source - clip.sourceStart) / clip.rate;
