import type { Project, Asset, TrackRole, PCM, Track, RecordingSession, EditState } from './types';
import { clone, uid } from './types';
import {
  parseScore,
  readScoreFile,
  setOpeningTempo,
  setNotationInstrument,
  type NotationInstrument,
} from './score';
import { tempoMap, projectDuration } from './time';
import { saveProject, getAsset, readSession, deleteSession } from './storage';
import { transport } from './transport';
import { encodeWav, clearClips, splitClips, trimClips } from './audio';
import { audioJobs } from './jobs';
import { clipSelection, clipTrimBounds } from './timeline';
import { clipSourceTime } from './clip-time';
import { scoreTempoProject } from './score-time';
import type { PreparedScore } from './pdf-import';

export type ImportItem = { file: File; role: TrackRole | 'score' };
export function guessRole(name: string): ImportItem['role'] {
  if (/\.(xml|musicxml|mxl|pdf)$/i.test(name)) return 'score';
  return /demo|示范|示範|演奏|performance|reference/i.test(name) ? 'demo' : 'backing';
}
export function audioAsset(project: Project, pcm: PCM, name: string): Asset {
  return {
    id: uid(),
    projectId: project.id,
    name,
    type: 'audio/wav',
    blob: new Blob([encodeWav(pcm, 32)], { type: 'audio/wav' }),
    sampleRate: pcm.sampleRate,
    frames: pcm.channels[0].length,
    channels: pcm.channels.length,
  };
}
export async function prepareImport(
  project: Project,
  items: ImportItem[],
  progress: (text: string) => void,
  options: { signal?: AbortSignal; converted?: PreparedScore } = {},
): Promise<{ project: Project; assets: Asset[] }> {
  const p = clone(project),
    assets: Asset[] = [];
  const pdfItems = items.filter((item) => item.role === 'score' && /\.pdf$/i.test(item.file.name));
  if (pdfItems.length > 100) throw Error('PDF 文件过多 / Choose at most 100 PDF files');
  if (
    items.filter((i) => i.role === 'score' && !pdfItems.includes(i)).length +
      (pdfItems.length ? 1 : 0) >
    1
  )
    throw Error('每个项目请选一份乐谱 / Choose one score per project');
  if ((p.score || p.pdfSource) && items.some((i) => i.role === 'score'))
    throw Error('请为另一份乐谱建立新项目 / Create a new project for another score');
  let saved = false;
  try {
    for (const { file, role } of items) {
      options.signal?.throwIfAborted();
      progress(file.name);
      if (file.size > 160 * 1024 * 1024)
        throw Error('单个文件请小于 160 MB / Keep each file below 160 MB');
      const asset: Asset = {
        id: uid(),
        projectId: p.id,
        name: file.name,
        type: file.type || 'application/octet-stream',
        blob: file,
      };
      if (role === 'score' && /\.pdf$/i.test(file.name)) {
        asset.type = 'application/pdf';
      } else if (role === 'score') {
        const xml = await readScoreFile(file),
          score = parseScore(xml);
        p.scoreXml = xml;
        p.score = score;
        p.scoreAssetId = asset.id;
        p.scoreMap = tempoMap(score);
      } else {
        const pcm = await transport.decode(file);
        if (pcm.channels.length > 2)
          throw Error('音轨需为单声道或立体声 / Audio tracks must be mono or stereo');
        const duration = pcm.channels[0].length / pcm.sampleRate;
        if (duration > 900)
          throw Error('单轨暂支持 15 分钟以内 / Maximum track duration is 15 minutes');
        asset.sampleRate = pcm.sampleRate;
        asset.frames = pcm.channels[0].length;
        asset.channels = pcm.channels.length;
        transport.pcm.set(asset.id, pcm);
        p.tracks.push({
          id: uid(),
          name: file.name.replace(/\.[^.]+$/, ''),
          role,
          sourceAssetId: asset.id,
          volume: role === 'demo' ? 0.7 : 0.8,
          pan: 0,
          mute: role === 'demo',
          solo: false,
          offset: 0,
          color: p.tracks.length % 4,
          clips: [
            {
              id: uid(),
              assetId: asset.id,
              label: file.name,
              start: 0,
              end: duration,
              sourceStart: 0,
              rate: 1,
              gain: 1,
              fadeIn: 0,
              fadeOut: 0,
            },
          ],
        });
      }
      assets.push(asset);
      p.assetIds.push(asset.id);
    }
    if (pdfItems.length)
      p.pdfSource = {
        version: 1,
        id: uid(),
        assetIds: assets
          .filter((asset) => asset.type === 'application/pdf')
          .map((asset) => asset.id),
        state: 'pending',
        createdAt: new Date().toISOString(),
      };
    if (options.converted) {
      const conversion = options.converted,
        originalAssetIds = conversion.originals.map((file) => {
          const id = uid();
          assets.push({
            id,
            projectId: p.id,
            name: file.name,
            type: 'application/pdf',
            blob: file,
          });
          p.assetIds.push(id);
          return id;
        }),
        auditAssetId = uid();
      assets.push({
        id: auditAssetId,
        projectId: p.id,
        name: 'score-conversion.json',
        type: 'application/json',
        blob: conversion.audit,
      });
      p.assetIds.push(auditAssetId);
      p.scoreConversion = {
        ...conversion.provenance,
        originalAssetIds,
        musicxmlAssetId: p.scoreAssetId!,
        auditAssetId,
      };
    }
    options.signal?.throwIfAborted();
    p.updatedAt = new Date().toISOString();
    p.revision++;
    const normalized = scoreTempoProject(p);
    saved = true;
    return { project: normalized, assets };
  } finally {
    if (!saved) for (const asset of assets) transport.pcm.delete(asset.id);
  }
}
export async function addFiles(
  project: Project,
  items: ImportItem[],
  progress: (text: string) => void,
  options: { signal?: AbortSignal; converted?: PreparedScore } = {},
): Promise<Project> {
  const prepared = await prepareImport(project, items, progress, options);
  try {
    await saveProject(prepared.project, prepared.assets, options.signal);
    return prepared.project;
  } catch (error) {
    for (const asset of prepared.assets) transport.pcm.delete(asset.id);
    throw error;
  }
}
// Import only appends material. Preserve every edit to the latest project while
// audio decoding or a background score conversion was running.
export function mergeImportedFiles(base: Project, latest: Project, prepared: Project): Project {
  if (base.id !== latest.id || prepared.id !== latest.id)
    throw Error('导入项目已改变 / Import project changed');
  const p = clone(latest),
    oldTrackIds = new Set(base.tracks.map((track) => track.id));
  p.tracks.push(...prepared.tracks.filter((track) => !oldTrackIds.has(track.id)));
  p.assetIds = [...new Set([...p.assetIds, ...prepared.assetIds])];
  if (!base.score && prepared.score) {
    if (p.score || p.pdfSource) throw Error('乐谱来源已改变 / Score source changed');
    p.score = prepared.score;
    p.scoreXml = prepared.scoreXml;
    p.scoreAssetId = prepared.scoreAssetId;
    p.scoreMap = prepared.scoreMap;
  }
  if (!base.pdfSource && prepared.pdfSource) {
    if (p.score || p.pdfSource) throw Error('乐谱来源已改变 / Score source changed');
    p.pdfSource = prepared.pdfSource;
  }
  return scoreTempoProject(p);
}

export function editProject(
  project: Project,
  label: string,
  mutate: (p: Project) => void,
): Project {
  const p = clone(project),
    snapshot = () => ({
      tracks: clone(p.tracks),
      selection: clone(p.selection),
      scoreMap: clone(p.scoreMap),
      referenceTrackId: p.referenceTrackId,
    }),
    before = snapshot();
  mutate(p);
  p.undo.push({ label, before, after: snapshot() });
  if (p.undo.length > 60) p.undo.shift();
  p.redo = [];
  return p;
}
export function changeScoreTempo(project: Project, bpm: number): Project {
  if (!project.scoreXml || !project.score) throw Error('先添加乐谱 / Add a score first');
  if (!project.score.tempoMissing && bpm === project.score.tempo[0]?.bpm) return project;
  const snapshot = (p: Project): EditState => ({
    tracks: clone(p.tracks),
    selection: clone(p.selection),
    scoreMap: clone(p.scoreMap),
    scoreXml: p.scoreXml,
    partId: p.score?.partId,
    position: p.position,
  });
  const before = snapshot(project),
    scoreXml = setOpeningTempo(project.scoreXml, bpm),
    score = parseScore(scoreXml, project.score.partId),
    next = scoreTempoProject({ ...project, scoreXml, score });
  next.undo = [...next.undo, { label: 'score tempo', before, after: snapshot(next) }].slice(-60);
  next.redo = [];
  return next;
}
export function undoProject(project: Project, redo = false): Project {
  const p = clone(project),
    command = (redo ? p.redo : p.undo).pop();
  if (!command) return p;
  const state = redo ? command.after : command.before;
  p.tracks = state.tracks;
  p.selection = state.selection;
  p.referenceTrackId = undefined;
  if (state.scoreXml !== undefined) {
    p.scoreXml = state.scoreXml;
    p.score = parseScore(state.scoreXml, state.partId);
  }
  if (state.position !== undefined) p.position = state.position;
  p.scoreMap = state.scoreMap?.length ? state.scoreMap : p.score ? tempoMap(p.score) : [];
  (redo ? p.undo : p.redo).push(command);
  return scoreTempoProject(p);
}
export function changeNotationInstrument(
  project: Project,
  instrument: NotationInstrument,
): Project {
  if (!project.scoreXml || !project.score) throw Error('先添加乐谱 / Add a score first');
  const snapshot = (p: Project): EditState => ({
      tracks: clone(p.tracks),
      selection: clone(p.selection),
      scoreMap: clone(p.scoreMap),
      scoreXml: p.scoreXml,
      partId: p.score?.partId,
      position: p.position,
    }),
    before = snapshot(project),
    scoreXml = setNotationInstrument(project.scoreXml, project.score.partId, instrument),
    next = { ...project, scoreXml, score: parseScore(scoreXml, project.score.partId) };
  next.undo = [...project.undo, { label: 'notation pitch', before, after: snapshot(next) }].slice(
    -60,
  );
  next.redo = [];
  return next;
}
export function addRecordingTrack(project: Project, name: string): Project {
  return editProject(project, 'add recording track', (p) => {
    p.tracks.push({
      id: uid(),
      name,
      role: 'recording',
      volume: 0.85,
      pan: 0,
      mute: false,
      solo: false,
      offset: 0,
      color: 2,
      clips: [],
    });
  });
}
export function editSelection(
  project: Project,
  action: 'split' | 'clear' | 'trim' | 'fade',
  trackId: string,
): Project {
  if (!project.selection) throw Error('先选择一个片段 / Select a passage first');
  const selection = project.selection;
  return editProject(project, action, (p) => {
    const t = p.tracks.find((t) => t.id === trackId);
    if (!t) throw Error('选择要编辑的音轨 / Choose a track');
    const selected = selection.clipId
      ? t.clips.find((clip) => clip.id === selection.clipId)
      : undefined;
    if (selection.clipId && !selected)
      throw Error('请重新选择音频片段 / Select the audio region again');
    const a = selection.start - t.offset,
      b = selection.end - t.offset;
    if (selected && (a < selected.start - 1e-7 || b > selected.end + 1e-7))
      throw Error('选区需在当前片段内 / Keep the range within this region');
    const region = selected ? clipSelection(t, selected) : null,
      wholeRegion =
        region &&
        Math.abs(selection.start - region.start) < 1e-7 &&
        Math.abs(selection.end - region.end) < 1e-7;
    const clips = selected ? [selected] : t.clips,
      edited =
        action === 'clear'
          ? wholeRegion
            ? []
            : clearClips(clips, a, b)
          : action === 'trim'
            ? trimClips(clips, a, b)
            : splitClips(clips, a, b);
    if (action === 'fade')
      for (const c of edited)
        if (c.start >= a - 1e-7 && c.end <= b + 1e-7) {
          c.fadeIn = Math.min(0.08, (c.end - c.start) / 4);
          c.fadeOut = c.fadeIn;
        }
    t.clips = selected
      ? t.clips.flatMap((clip) => (clip.id === selected.id ? edited : [clip]))
      : edited;
    if (selected) {
      const inside = edited.find((clip) => clip.start >= a - 1e-7 && clip.end <= b + 1e-7);
      p.selection = inside ? { ...selection, clipId: inside.id } : null;
      if (!p.selection) p.loop = false;
    }
  });
}
export function trimRegion(
  project: Project,
  trackId: string,
  clipId: string,
  from: number,
  to: number,
  sourceDuration?: number,
): Project {
  return editProject(project, 'trim region', (p) => {
    const track = p.tracks.find((track) => track.id === trackId),
      clip = track?.clips.find((clip) => clip.id === clipId);
    if (!track || !clip) throw Error('找不到片段 / Region is missing');
    const a = from - track.offset,
      b = to - track.offset,
      bounds = clipTrimBounds(track, clip, sourceDuration);
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      b <= a ||
      from < 0 ||
      (project.score && to > projectDuration(project) + 1e-7) ||
      a < bounds.start - 1e-7 ||
      b > bounds.end + 1e-7
    )
      throw Error(
        '裁剪不可超出原音频或覆盖相邻片段 / Keep trims within the source and neighboring regions',
      );
    const leftChanged = Math.abs(a - clip.start) > 1e-7,
      rightChanged = Math.abs(b - clip.end) > 1e-7;
    clip.sourceStart = Math.max(0, clipSourceTime(clip, a));
    clip.start = a;
    clip.end = b;
    clip.fadeIn = Math.min(leftChanged ? Math.max(0.003, clip.fadeIn) : clip.fadeIn, (b - a) / 4);
    clip.fadeOut = Math.min(
      rightChanged ? Math.max(0.003, clip.fadeOut) : clip.fadeOut,
      (b - a) / 4,
    );
    p.selection = clipSelection(track, clip);
  });
}
export async function finishTake(
  project: Project,
  sessionId: string,
  interrupted = false,
): Promise<Project> {
  if (project.takes.some((t) => t.id === sessionId)) {
    await deleteSession(sessionId);
    return clone(project);
  }
  const { session, channels } = await readSession(sessionId),
    pcm = { sampleRate: session.sampleRate, channels };
  const asset = audioAsset(project, pcm, `${session.name}.wav`),
    duration = channels[0].length / session.sampleRate;
  const rawStart = session.start - (session.latencyMs / 1000) * session.speed,
    start = Math.max(0, rawStart),
    end = rawStart + duration * session.speed;
  const sourceStart = Math.max(0, -rawStart) / session.speed;
  const p = editProject(project, 'record', (p) => {
    let track = p.tracks.find((t) => t.id === session.trackId);
    if (!track) {
      track = {
        id: session.trackId,
        name: session.name,
        role: 'recording',
        sourceAssetId: asset.id,
        volume: 0.85,
        pan: 0,
        mute: false,
        solo: false,
        offset: 0,
        color: 2,
        clips: [],
      };
      p.tracks.push(track);
    }
    track.sourceAssetId ??= asset.id;
    // Punch replacement is non-destructive. Every original take remains in p.takes.
    if (end > start) {
      track.clips = clearClips(track.clips, start - track.offset, end - track.offset);
      track.clips.push({
        id: uid(),
        assetId: asset.id,
        label: session.name,
        start: start - track.offset,
        end: end - track.offset,
        sourceStart,
        rate: 1 / session.speed,
        gain: 1,
        fadeIn: 0.005,
        fadeOut: 0.005,
      });
    }
    track.clips.sort((a, b) => a.start - b.start);
    if (
      p.selection?.clipId &&
      p.selection.trackId === track.id &&
      !track.clips.some((clip) => clip.id === p.selection!.clipId)
    ) {
      p.selection = null;
      p.loop = false;
    }
  });
  p.assetIds.push(asset.id);
  p.takes.push({
    id: session.id,
    name: session.name,
    assetId: asset.id,
    trackId: session.trackId,
    start: rawStart,
    end,
    speed: session.speed,
    sampleRate: session.sampleRate,
    channels: session.channels,
    createdAt: session.createdAt,
    inputLabel: session.inputLabel,
    latencyMs: session.latencyMs,
    interrupted,
  });
  p.updatedAt = new Date().toISOString();
  p.revision++;
  await saveProject(p, [asset]);
  await deleteSession(sessionId);
  transport.pcm.set(asset.id, pcm);
  return p;
}
export function newRecordingSession(
  project: Project,
  trackId: string,
  start: number,
  sampleRate: number,
  channels: number,
  inputLabel: string,
  latencyMs: number,
): RecordingSession {
  return {
    id: uid(),
    projectId: project.id,
    trackId,
    name: `Take ${project.takes.length + 1}`,
    start,
    speed: project.speed,
    sampleRate,
    channels,
    createdAt: new Date().toISOString(),
    inputLabel,
    latencyMs,
    chunks: 0,
    frames: 0,
  };
}
export async function renderExport(
  project: Project,
  track: Track,
  from = 0,
  to = projectDuration(project),
  mixed = false,
  speed = 1,
): Promise<PCM> {
  const normalized = scoreTempoProject(project);
  track = normalized.tracks.find((item) => item.id === track.id) || track;
  project = normalized;
  if (!project.score || project.score.tempoMissing)
    throw Error('先添加乐谱并确认谱面速度 / Add a score and confirm its tempo');
  const buffers = await Promise.all(
    [...new Set(track.clips.map((c) => c.assetId))].map(async (id) => [
      id,
      await transport.asset(id),
    ]),
  );
  const pcm = await audioJobs.run<PCM>('render', {
    track,
    buffers,
    from,
    to,
    sampleRate: transport.ctx.sampleRate,
    speed,
    mixed,
  });
  const frames = Math.max(1, Math.round(((to - from) / speed) * 48000));
  return pcm.sampleRate === 48000 && pcm.channels[0].length === frames
    ? pcm
    : audioJobs.run<PCM>('resample', { pcm, sampleRate: 48000, frames });
}
export async function originalTake(assetId: string) {
  return (await getAsset(assetId)).blob;
}
