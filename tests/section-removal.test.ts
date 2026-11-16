import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { newProject } from '../src/lib/storage';
import { editSelection, undoProject } from '../src/lib/project';
import { clipSelection } from '../src/lib/timeline';
import type { Clip, Track } from '../src/lib/types';

const clip = (id: string, start: number, end: number): Clip => ({
  id,
  assetId: 'original-recording',
  label: id,
  start,
  end,
  sourceStart: start,
  rate: 1,
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
});
const track = (id: string, clips: Clip[], offset = 0): Track => ({
  id,
  name: id,
  role: 'recording',
  clips,
  offset,
  volume: 1,
  pan: 0,
  mute: false,
  solo: false,
  color: 0,
});

it('deletes an entire selected region, preserves neighboring tracks/regions, and supports undo/redo', () => {
  const project = newProject('Delete section'),
    sections = [clip('First', 0, 3), clip('Middle', 3, 7), clip('Last', 7, 10)];
  project.tracks = [track('take', sections, 0.625), track('other', [clip('Other', 0, 10)])];
  project.selection = clipSelection(project.tracks[0], sections[1]);
  project.loop = true;
  const removed = editSelection(project, 'clear', 'take');
  expect(removed.tracks[0].clips).toEqual([sections[0], sections[2]]);
  expect(removed.tracks[1]).toEqual(project.tracks[1]);
  expect(removed.selection).toBeNull();
  expect(removed.loop).toBe(false);
  expect(project.tracks[0].clips).toEqual(sections);
  const restored = undoProject(removed);
  expect(restored.tracks).toEqual(project.tracks);
  expect(restored.selection).toEqual(project.selection);
  expect(undoProject(restored, true).tracks).toEqual(removed.tracks);
});

it("deletes a track's only region without deleting its recording source or the track", () => {
  const project = newProject('Remove section');
  project.tracks = [
    { ...track('take', [clip('Full take', 0, 10)]), sourceAssetId: 'original-recording' },
  ];
  project.selection = clipSelection(project.tracks[0], project.tracks[0].clips[0]);
  const removed = editSelection(project, 'clear', 'take');
  expect(removed.tracks).toHaveLength(1);
  expect(removed.tracks[0]).toMatchObject({
    id: 'take',
    clips: [],
    sourceAssetId: 'original-recording',
  });
  expect(undoProject(removed).tracks).toEqual(project.tracks);
});

it('deletes only the selected subrange without shifting the remaining audio', () => {
  const project = newProject('Remove passage');
  project.tracks = [track('take', [clip('Full take', 1, 9)], 0.5)];
  project.selection = { start: 3.5, end: 5.5, trackId: 'take', clipId: 'Full take' };
  const removed = editSelection(project, 'clear', 'take');
  expect(removed.tracks[0].clips).toMatchObject([
    { start: 1, end: 3, sourceStart: 1 },
    { start: 5, end: 9, sourceStart: 5 },
  ]);
  expect(removed.selection).toBeNull();
});

it('removes the complete region when its track offset places part before time zero', () => {
  const project = newProject('Earlier take'),
    first = clip('First', 0, 5),
    next = clip('Next', 5, 9);
  project.tracks = [track('take', [first, next], -1.25)];
  project.selection = clipSelection(project.tracks[0], first);
  expect(project.selection).toMatchObject({ start: 0, end: 3.75 });
  const removed = editSelection(project, 'clear', 'take');
  expect(removed.tracks[0].clips).toEqual([next]);
  expect(undoProject(removed).tracks).toEqual(project.tracks);
});
