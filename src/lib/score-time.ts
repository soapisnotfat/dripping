import type { Anchor, Clip, EditState, Project, Selection, Track } from './types';
import { clone } from './types';
import { clipSourceTime } from './clip-time';
import { qToSeconds, secondsToQ, tempoMap } from './time';

// Move arrangements, including their history, onto the written score's clock.
// Original PCM and take metadata are never rewritten; variable-rate relationships
// stay inside each region so a take does not become many visible fragments.
export function scoreTempoProject(project: Project): Project {
  if (!project.score) return project;
  const target = tempoMap(project.score),
    old = project.scoreMap.length >= 2 ? project.scoreMap : target,
    end = target.at(-1)!.seconds;
  const same = (map: Anchor[]) => JSON.stringify(map) === JSON.stringify(target);
  const historic = [...project.undo, ...project.redo].some((command) =>
    [command.before, command.after].some(
      (state) => !!state.referenceTrackId || (!!state.scoreMap && !same(state.scoreMap)),
    ),
  );
  const needs =
    historic ||
    !same(old) ||
    !!project.referenceTrackId ||
    project.tracks.some((track) =>
      track.clips.some((clip) => clip.end + track.offset > end + 1e-7),
    );
  if (!needs) return project;
  const result = clone(project),
    convert = (value: number, map: Anchor[]) => qToSeconds(secondsToQ(value, map), target);
  const tracks = (input: Track[], map: Anchor[]) =>
    input.map((track) => {
      const clips: Clip[] = [];
      for (const clip of track.clips) {
        const start = clip.start + track.offset,
          finish = clip.end + track.offset,
          a = Math.max(0, convert(start, map)),
          b = Math.min(end, convert(finish, map));
        if (b <= a) continue;
        const knots = [
          start,
          finish,
          ...map.map((point) => point.seconds),
          ...target.map((point) => qToSeconds(point.q, map)),
          ...(clip.timeMap || []).map((point) => point.time + track.offset),
        ]
          .filter((time) => time >= start && time <= finish)
          .sort((a, b) => a - b)
          .filter((value, index, all) => !index || value - all[index - 1] > 1e-8);
        const points = knots.map((time) => ({
          time: convert(time, map),
          source: clipSourceTime(clip, time - track.offset),
        }));
        const first = points[0],
          last = points.at(-1)!,
          rate = (last.source - first.source) / (last.time - first.time),
          linear = points.every(
            (point) =>
              Math.abs(point.source - first.source - (point.time - first.time) * rate) < 1e-6,
          );
        const next: Clip = {
          ...clip,
          start: a,
          end: b,
          sourceStart: 0,
          rate: linear ? rate : 1,
          timeMap: points,
          fadeIn: Math.min(
            clip.fadeIn ? convert(start + clip.fadeIn, map) - convert(start, map) : 0,
            (b - a) / 4,
          ),
          fadeOut: Math.min(
            clip.fadeOut ? convert(finish, map) - convert(finish - clip.fadeOut, map) : 0,
            (b - a) / 4,
          ),
        };
        next.sourceStart = Math.max(0, clipSourceTime(next, a));
        if (linear) next.timeMap = undefined;
        clips.push(next);
      }
      return { ...track, offset: 0, clips };
    });
  const selection = (value: Selection | null, map: Anchor[], current: Track[]) => {
    if (!value) return null;
    const start = Math.max(0, convert(value.start, map)),
      finish = Math.min(end, convert(value.end, map));
    if (
      finish <= start ||
      (value.clipId &&
        !current.some(
          (track) =>
            track.id === value.trackId && track.clips.some((clip) => clip.id === value.clipId),
        ))
    )
      return null;
    return { ...value, start, end: finish };
  };
  const state = (value: EditState): EditState => {
    const map = value.scoreMap?.length ? value.scoreMap : old,
      current = tracks(value.tracks, map);
    return {
      ...value,
      tracks: current,
      selection: selection(value.selection, map, current),
      position:
        value.position === undefined
          ? undefined
          : Math.max(0, Math.min(end, convert(value.position, map))),
      scoreMap: clone(target),
      referenceTrackId: undefined,
    };
  };
  result.tracks = tracks(result.tracks, old);
  result.selection = selection(result.selection, old, result.tracks);
  result.position = Math.max(0, Math.min(end, convert(result.position, old)));
  result.scoreMap = target;
  result.referenceTrackId = undefined;
  result.undo = result.undo.map((command) => ({
    ...command,
    before: state(command.before),
    after: state(command.after),
  }));
  result.redo = result.redo.map((command) => ({
    ...command,
    before: state(command.before),
    after: state(command.after),
  }));
  if (!result.selection) result.loop = false;
  return result;
}
