import { expect, it } from 'vitest';
import { dtw, type Features } from '../src/lib/alignment';
function frames(pitches: number[]): Features {
  const values = new Float32Array(pitches.length * 12);
  for (let i = 0; i < pitches.length; i++) values[i * 12 + pitches[i]] = 1;
  return {
    values,
    energy: new Float32Array(pitches.length).fill(1),
    frames: pitches.length,
    hop: 0.1,
    duration: pitches.length * 0.1,
  };
}
it('retains ordinary subsequence behavior while optionally pinning verified segment boundaries', () => {
  const reference = frames([0, 2, 4, 5]),
    audio = frames([7, 0, 2, 4, 5, 9, 7]),
    free = dtw(reference, audio),
    pinned = dtw(reference, audio, false, { start: true, end: true });
  expect(free.path[0][1]).toBe(1);
  expect(free.path.at(-1)![1]).toBe(4);
  expect(pinned.path[0]).toEqual([0, 0]);
  expect(pinned.path.at(-1)).toEqual([3, 6]);
});
it('supports independently fixed start and end for open score edges', () => {
  const reference = frames([0, 2, 4]),
    audio = frames([0, 2, 4, 7, 9]),
    start = dtw(reference, audio, false, { start: true });
  expect(start.path[0]).toEqual([0, 0]);
  expect(start.path.at(-1)).toEqual([2, 2]);
  const end = dtw(reference, frames([7, 9, 0, 2, 4]), false, { end: true });
  expect(end.path[0]).toEqual([0, 2]);
  expect(end.path.at(-1)).toEqual([2, 4]);
});
