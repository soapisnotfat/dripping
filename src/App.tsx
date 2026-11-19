import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Locale, Project, Track, Selection, RecordingSession } from './lib/types';
import { clone, clamp } from './lib/types';
import {
  listProjects,
  getProject,
  saveProject,
  newProject,
  recoverySessions,
  deleteSession,
} from './lib/storage';
import {
  editProject,
  editSelection,
  trimRegion,
  finishTake,
  newRecordingSession,
  addRecordingTrack,
  addFiles,
  mergeImportedFiles,
  guessRole,
  changeScoreTempo,
  undoProject,
  changeNotationInstrument,
  changeNotePitch,
} from './lib/project';
import {
  parseScore,
  writtenPitchAt,
  type NotationInstrument,
  type WrittenPitch,
} from './lib/score';
import { projectDuration, positionLabel, musicalLabel, qToSeconds, secondsToQ } from './lib/time';
import { transport } from './lib/transport';
import { clipSelection } from './lib/timeline';
import { PCMRecorder } from './lib/recorder';
import { probeInput } from './lib/input';
import { peaks } from './lib/audio';
import { demoFiles } from './lib/demo';
import { ScoreView, type CursorMode } from './components/ScoreView';
import { PdfSource } from './components/PdfSource';
import { Timeline, type Waveform } from './components/Timeline';
import { Modal, ImportDialog, AlignmentDialog, ExportDialog } from './components/dialogs';
import { PitchCorrectionDialog } from './components/dialogs/PitchCorrectionDialog';
import { pdfFiles, attachPdfScore, pdfFailure } from './lib/pdf-project';
import type { ConversionProgress } from './lib/pdf-import';
import { InputMeter } from './components/InputMeter';
import { SelectionEditor } from './components/SelectionEditor';
import { scoreTempoProject } from './lib/score-time';
import { AudioLevels } from './components/AudioLevels';
import { ScoreTempo } from './components/ScoreTempo';
import { ScorePitch } from './components/ScorePitch';
import { DraftNumber } from './components/DraftNumber';
import { editLabel } from './lib/edit-label';
import { Icon } from './components/Icon';
import { Brand } from './components/Brand';
import { useAudioDevices } from './hooks/useAudioDevices';
import { recordingRouteKey, useRecordingOffset } from './hooks/useRecordingOffset';
import { LiveWaveform } from './lib/live-waveform';

export default function App() {
  const [locale, setLocale] = useState<Locale>(
    () =>
      (localStorage.getItem('dripping.locale') ||
        (navigator.language.startsWith('zh') ? 'zh' : 'en')) as Locale,
  );
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [theme, setTheme] = useState(localStorage.getItem('dripping.theme') || 'system');
  const [project, setProject] = useState<Project | null>(null),
    pRef = useRef<Project | null>(null);
  const [library, setLibrary] = useState<Project[]>([]),
    [showLibrary, setShowLibrary] = useState(false);
  const [modal, setModal] = useState<
      'new' | 'import' | 'alignment' | 'export' | 'settings' | 'track' | 'note-pitch' | null
    >(null),
    [trackId, setTrackId] = useState(''),
    [pitchTarget, setPitchTarget] = useState<{
      id: string;
      projectId: string;
      pitch: WrittenPitch;
      measure: string;
    } | null>(null);
  const [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [recording, setRecording] = useState(false),
    [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('saved'),
    [ready, setReady] = useState(false);
  const [viewPdf, setViewPdf] = useState(false);
  const [zoom, setZoom] = useState(0.9),
    [scale, setScale] = useState(42),
    [followScore, setFollowScore] = useState(true),
    [followTimeline, setFollowTimeline] = useState(true),
    [snap, setSnap] = useState(true),
    [mode, setMode] = useState<CursorMode>('note');
  const [reference, setReference] = useState(false),
    [instrument, setInstrument] = useState<'flute' | 'piano'>('flute'),
    [metronome, setMetronome] = useState(false);
  const cuePreferences = useRef({ reference, metronome });
  cuePreferences.current = { reference, metronome };
  const [waveforms, setWaveforms] = useState(new Map<string, Waveform>()),
    [menu, setMenu] = useState<{ x: number; y: number; noteId?: string } | null>(null),
    [editingTrack, setEditingTrack] = useState('');
  const [channels, setChannels] = useState(localStorage.getItem('dripping.inputChannels') || '0'),
    [countIn, setCountIn] = useState(4),
    [monitor, setMonitor] = useState(false),
    [meter, setMeter] = useState(0);
  const [inputStatus, setInputStatus] = useState(''),
    [probing, setProbing] = useState(false),
    [checkingInput, setCheckingInput] = useState(false),
    [inputClipped, setInputClipped] = useState(false);
  const audioDevices = useAudioDevices({ locked: recording || !!busy || probing || checkingInput }),
    { devices, inputId: device, outputId } = audioDevices,
    { latency, setLatency, savedForRoute } = useRecordingOffset(
      devices,
      device,
      outputId,
      channels,
      devices.length > 0 &&
        !audioDevices.routing &&
        !['detecting', 'permission-needed', 'deferred', 'unavailable'].includes(
          audioDevices.status,
        ),
    );
  const [armedTrackId, setArmedTrackId] = useState('');
  const armedTrack = project?.tracks.find((t) => t.id === armedTrackId && t.role === 'recording');
  const [recoveries, setRecoveries] = useState<RecordingSession[]>([]),
    [update, setUpdate] = useState<ServiceWorker | null>(null);
  const recorder = useRef<PCMRecorder | null>(null),
    liveWaveform = useRef<LiveWaveform | null>(null),
    session = useRef<RecordingSession | null>(null),
    finishing = useRef(false),
    saveQueue = useRef(Promise.resolve()),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pdfAuto = useRef<string | null>(null),
    pdfJob = useRef<{ projectId: string; sourceId: string; controller: AbortController } | null>(
      null,
    );
  const [pdfActivity, setPdfActivity] = useState<{
    projectId: string;
    sourceId: string;
    progress: ConversionProgress;
  } | null>(null);
  const durable = useRef(new Map<string, number>()),
    drafts = useRef(new Map<string, Project>()),
    stagedAssets = useRef(new Map<string, Map<string, Asset>>());
  const report = useCallback((message: string) => {
    setError(message.replace(/^Error: /, ''));
  }, []);
  const persist = useCallback(
    (p: Project, assets: Asset[] = []) => {
      const snapshot = clone(p);
      if (snapshot.revision >= (drafts.current.get(p.id)?.revision ?? -1))
        drafts.current.set(p.id, snapshot);
      const pending = stagedAssets.current.get(p.id) || new Map<string, Asset>();
      for (const asset of assets) pending.set(asset.id, asset);
      stagedAssets.current.set(p.id, pending);
      if (pRef.current?.id === p.id) setSaved('saving');
      const task = saveQueue.current
        .catch(() => {})
        .then(async () => {
          const batch = [...pending.values()];
          await saveProject(snapshot, batch);
          for (const asset of batch) if (pending.get(asset.id) === asset) pending.delete(asset.id);
          if (!pending.size) stagedAssets.current.delete(p.id);
          durable.current.set(p.id, Math.max(durable.current.get(p.id) ?? -1, snapshot.revision));
          if ((drafts.current.get(p.id)?.revision ?? Infinity) <= snapshot.revision)
            drafts.current.delete(p.id);
        });
      saveQueue.current = task;
      return task
        .then(() => {
          const current = pRef.current;
          if (current?.id === p.id)
            setSaved(
              (durable.current.get(p.id) ?? -1) >=
                Math.max(current.revision, drafts.current.get(p.id)?.revision ?? -1)
                ? 'saved'
                : 'saving',
            );
        })
        .catch((e) => {
          const current = pRef.current;
          if (
            current?.id === p.id &&
            (durable.current.get(p.id) ?? -1) <
              Math.max(current.revision, drafts.current.get(p.id)?.revision ?? -1)
          ) {
            setSaved('error');
            report(String(e));
          }
          throw e;
        });
    },
    [report],
  );
  const change = useCallback(
    (p: Project) => {
      p.updatedAt = new Date().toISOString();
      p.revision = Math.max(p.revision, drafts.current.get(p.id)?.revision ?? -1) + 1;
      drafts.current.set(p.id, p);
      pRef.current = p;
      setProject(p);
      setSaved('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(p).catch(() => {});
      }, 400);
    },
    [persist],
  );
  const cancelPdfRecognition = useCallback(() => {
    const job = pdfJob.current;
    pdfAuto.current = null;
    if (!job) return;
    pdfJob.current = null;
    job.controller.abort();
    setPdfActivity(null);
    const latest = pRef.current;
    if (latest?.id === job.projectId && latest.pdfSource?.id === job.sourceId && !latest.scoreXml)
      change({ ...latest, pdfSource: { ...latest.pdfSource, state: 'paused', error: undefined } });
  }, [change]);
  const commit = useCallback(
    async (p: Project, assets: Asset[] = []) => {
      clearTimeout(saveTimer.current);
      p.updatedAt = new Date().toISOString();
      p.revision = Math.max(p.revision, drafts.current.get(p.id)?.revision ?? -1) + 1;
      if (!pRef.current || pRef.current.id === p.id) {
        pRef.current = p;
        setProject(p);
      }
      await persist(p, assets);
    },
    [persist],
  );
  const open = useCallback(
    (p: Project, options?: { recognizePdf?: boolean }) => {
      if (pdfJob.current && pdfJob.current.projectId !== p.id) cancelPdfRecognition();
      pdfAuto.current = options?.recognizePdf && p.pdfSource ? `${p.id}:${p.pdfSource.id}` : null;
      const storedRevision = p.revision;
      if (pRef.current?.id === p.id && pRef.current.revision > p.revision) p = pRef.current;
      const prior = pRef.current;
      if (prior && prior.id !== p.id && (durable.current.get(prior.id) ?? -1) < prior.revision)
        void persist(prior).catch(() => {});
      const draft = drafts.current.get(p.id);
      durable.current.set(p.id, Math.max(durable.current.get(p.id) ?? -1, storedRevision));
      if (draft && draft.revision > storedRevision) p = clone(draft);
      if (p.scoreXml) p = { ...p, score: parseScore(p.scoreXml, p.score?.partId) };
      const normalized = scoreTempoProject(p);
      if (normalized !== p) {
        normalized.revision = Math.max(p.revision, drafts.current.get(p.id)?.revision ?? -1) + 1;
        drafts.current.set(p.id, normalized);
      }
      p = normalized;
      clearTimeout(saveTimer.current);
      transport.reset();
      pRef.current = p;
      setProject(p);
      setPosition(p.position);
      transport.seek(p.position);
      setPlaying(false);
      setWaveforms(new Map());
      setModal(null);
      setShowLibrary(false);
      setMenu(null);
      setEditingTrack('');
      setArmedTrackId('');
      setInputClipped(false);
      liveWaveform.current = null;
      localStorage.setItem('dripping.lastProject', p.id);
      const needsSave = (durable.current.get(p.id) ?? -1) < p.revision;
      setSaved(needsSave ? 'saving' : 'saved');
      if (needsSave) void persist(p).catch(() => {});
    },
    [persist, cancelPdfRecognition],
  );
  const addImported = async (base: Project, prepared: { project: Project; assets: Asset[] }) => {
    let staged = false;
    try {
      const latest = pRef.current;
      if (!latest || latest.id !== base.id)
        throw Error(t('项目已切换，请重新添加素材', 'Project changed; add the files again'));
      const next = mergeImportedFiles(base, latest, prepared.project);
      if (!base.pdfSource && next.pdfSource) pdfAuto.current = `${next.id}:${next.pdfSource.id}`;
      staged = true;
      await commit(next, prepared.assets);
    } catch (error) {
      if (!staged) {
        for (const asset of prepared.assets) transport.pcm.delete(asset.id);
        throw error;
      } /* Save retry and backup retain staged assets. */
    }
  };
  const retrySave = async () => {
    const current = pRef.current;
    if (!current) return;
    const draft = drafts.current.get(current.id),
      latest = draft && draft.revision > current.revision ? draft : current;
    clearTimeout(saveTimer.current);
    setError('');
    try {
      await persist(latest);
      if (pRef.current?.id === latest.id && pRef.current.revision <= latest.revision) {
        pRef.current = latest;
        setProject(latest);
        setPosition(latest.position);
        transport.seek(latest.position);
      }
    } catch {
      /* Keep the draft and assets available for another retry. */
    }
  };
  const startPdfRecognition = async () => {
    const initial = pRef.current,
      source = initial?.pdfSource;
    if (!initial || !source || initial.scoreXml || source.state === 'complete' || pdfJob.current)
      return;
    pdfAuto.current = null;
    if (source.state !== 'pending' || source.error)
      change({ ...initial, pdfSource: { ...source, state: 'pending', error: undefined } });
    const job = { projectId: initial.id, sourceId: source.id, controller: new AbortController() };
    pdfJob.current = job;
    setPdfActivity({ ...job, progress: { phase: 'loading' } });
    let updated = 0,
      lastPhase = '';
    try {
      const files = await pdfFiles(initial);
      job.controller.signal.throwIfAborted();
      const { convertPdf } = await import('./lib/pdf-import');
      const result = await convertPdf(files, job.controller.signal, (progress) => {
        if (pdfJob.current !== job) return;
        const now = performance.now();
        if (progress.phase === lastPhase && now - updated < 150) return;
        updated = now;
        lastPhase = progress.phase;
        setPdfActivity({ projectId: job.projectId, sourceId: job.sourceId, progress });
      });
      const latest = pRef.current;
      if (pdfJob.current !== job || job.controller.signal.aborted || latest?.id !== job.projectId)
        return;
      const completed = attachPdfScore(latest, job.sourceId, result);
      if (completed) await commit(completed.project, completed.assets);
    } catch (error) {
      if (pdfJob.current !== job || job.controller.signal.aborted) return;
      const latest = pRef.current;
      if (latest?.id === job.projectId && latest.pdfSource?.id === job.sourceId && !latest.scoreXml)
        change({
          ...latest,
          pdfSource: { ...latest.pdfSource, state: 'failed', error: pdfFailure(error) },
        });
    } finally {
      if (pdfJob.current === job) {
        pdfJob.current = null;
        setPdfActivity(null);
      }
    }
  };
  useEffect(() => setViewPdf(false), [project?.id]);
  useEffect(() => {
    const key = project?.pdfSource ? `${project.id}:${project.pdfSource.id}` : null;
    if (key && pdfAuto.current === key) void startPdfRecognition();
  }, [project?.id, project?.pdfSource?.id]);
  useEffect(
    () => () => {
      pdfJob.current?.controller.abort();
    },
    [],
  );
  useEffect(() => {
    (async () => {
      try {
        setLibrary(await listProjects());
        setRecoveries(await recoverySessions());
        const id = localStorage.getItem('dripping.lastProject');
        if (id) {
          const p = await getProject(id);
          if (p) open(p);
        }
      } catch (e) {
        report(String(e));
      } finally {
        setReady(true);
      }
    })();
  }, [open, report]);
  useEffect(() => {
    localStorage.setItem('dripping.locale', locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dripping.theme', theme);
  }, [theme]);
  useEffect(() => {
    transport.reference = reference;
    transport.metronome = metronome;
    transport.referenceInstrument = instrument;
    if (pRef.current) transport.updateMix(pRef.current, session.current?.trackId);
  }, [reference, metronome, instrument]);
  useEffect(() => {
    let canceled = false;
    if (project)
      for (const id of [...new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))]) {
        if (waveforms.has(id)) continue;
        transport
          .asset(id)
          .then((pcm) => {
            if (!canceled)
              setWaveforms((prev) =>
                new Map(prev).set(id, {
                  peaks: peaks(pcm),
                  duration: pcm.channels[0].length / pcm.sampleRate,
                }),
              );
          })
          .catch((e) => {
            if (!canceled) report(String(e));
          });
      }
    return () => {
      canceled = true;
    };
  }, [project?.id, project?.assetIds.join(','), report]);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (reg.waiting) setUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller)
              setUpdate(worker);
          });
        });
      })
      .catch((e) => report(t('离线缓存失败：', 'Offline cache failed: ') + String(e)));
  }, [report]);
  const pause = useCallback(() => {
    const value = transport.pause();
    setPlaying(false);
    setPosition(value);
    if (pRef.current) change({ ...pRef.current, position: value });
  }, [change]);
  const updateScoreTempo = (bpm: number) => {
    const p = pRef.current;
    if (
      !p?.score ||
      !p.scoreXml ||
      recording ||
      playing ||
      busy ||
      (!p.score.tempoMissing && bpm === p.score.tempo[0]?.bpm)
    )
      return;
    try {
      const next = changeScoreTempo(p, bpm);
      transport.seek(next.position);
      setPosition(next.position);
      change(next);
    } catch (error) {
      report(String(error));
    }
  };
  const updateNotation = (instrument: NotationInstrument) => {
    if (!pRef.current?.score || recording || playing || busy) return;
    try {
      change(changeNotationInstrument(pRef.current, instrument));
    } catch (error) {
      report(String(error));
    }
  };
  const correctPitch = (id: string) => {
    const current = pRef.current;
    if (!current?.score || !current.scoreXml || recording || playing || busy) return;
    try {
      const pitch = writtenPitchAt(current.scoreXml, current.score, id);
      const note = current.score.measures
        .flatMap((measure) => measure.notes)
        .find((item) => item.id === id);
      if (!pitch || !note) return;
      setPitchTarget({
        id,
        projectId: current.id,
        pitch,
        measure: current.score.measures[note.measure].number,
      });
      setMenu(null);
      setModal('note-pitch');
    } catch (error) {
      report(String(error));
    }
  };
  const finalize = useCallback(
    async (interrupted = false) => {
      if (finishing.current || !session.current || !pRef.current) return;
      finishing.current = true;
      const active = session.current;
      transport.pause();
      setPlaying(false);
      setRecording(false);
      setBusy(locale === 'zh' ? '保存录音…' : 'Saving take…');
      try {
        await recorder.current?.stop();
        const p = await finishTake(pRef.current, active.id, interrupted);
        await commit(p);
        setPosition(active.start);
        transport.seek(active.start);
        setRecoveries(await recoverySessions());
      } catch (e) {
        report(String(e));
        setRecoveries(await recoverySessions());
      } finally {
        recorder.current?.close();
        recorder.current = null;
        liveWaveform.current = null;
        session.current = null;
        finishing.current = false;
        setCounting(false);
        setMeter(0);
        setBusy('');
      }
    },
    [locale, commit, report],
  );
  useEffect(() => {
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (transport.playing && now - last > 30) {
        last = now;
        setPosition(transport.position());
        setCounting(transport.countingIn);
        if (transport.finished) {
          if (session.current) void finalize();
          else pause();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pause, finalize]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (
        session.current ||
        saved !== 'saved' ||
        drafts.current.size ||
        stagedAssets.current.size
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [saved]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden && session.current) void finalize(true);
    };
    const state = () => {
      if (transport.ctx.state === 'suspended' && session.current) void finalize(true);
    };
    document.addEventListener('visibilitychange', visibility);
    if (recording) transport.ctx.addEventListener('statechange', state);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      if (recording) transport.ctx.removeEventListener('statechange', state);
    };
  }, [recording, finalize]);
  const play = async () => {
    if (!pRef.current?.score || pRef.current.score.tempoMissing || busy || recording) return;
    if (playing) {
      pause();
      return;
    }
    try {
      setBusy(t('准备播放…', 'Preparing playback…'));
      const p = pRef.current;
      let start = position >= projectDuration(p) - 0.01 ? 0 : position;
      if (p.loop && p.selection && (start < p.selection.start || start >= p.selection.end))
        start = p.selection.start;
      transport.reference = reference;
      await transport.start(p, start, (name) => setBusy(t('准备音轨：', 'Preparing: ') + name));
      setPlaying(true);
    } catch (e) {
      report(String(e));
    } finally {
      setBusy('');
    }
  };
  const seek = async (seconds: number) => {
    if (!pRef.current || recording || busy) return;
    const value = clamp(seconds, 0, projectDuration(pRef.current)),
      wasPlaying = playing;
    transport.pause();
    transport.seek(value);
    setPosition(value);
    setPlaying(false);
    change({ ...pRef.current, position: value });
    if (wasPlaying) {
      try {
        setBusy(t('定位中…', 'Seeking…'));
        await transport.start(pRef.current, value);
        setPlaying(true);
      } catch (e) {
        report(String(e));
      } finally {
        setBusy('');
      }
    }
  };
  const select = (selection: Selection | null) => {
    if (pRef.current && !recording) {
      if (selection) {
        selection = {
          ...selection,
          start: Math.max(0, selection.start),
          end: Math.min(projectDuration(pRef.current), selection.end),
        };
        if (selection.end <= selection.start) selection = null;
      }
      change({ ...pRef.current, selection, loop: selection ? pRef.current.loop : false });
      if (selection?.trackId) setEditingTrack(selection.trackId);
    }
  };
  const trackChange = (id: string, patch: Partial<Track>) => {
    if (!pRef.current || busy) return;
    if (
      recording &&
      Object.keys(patch).some((key) => !['mute', 'solo', 'volume', 'pan'].includes(key))
    )
      return;
    const p = {
      ...pRef.current,
      tracks: pRef.current.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    };
    change(p);
    transport.updateMix(p, session.current?.trackId);
  };
  const history = (redo = false) => {
    if (!pRef.current || recording || busy) return;
    pause();
    try {
      const next = undoProject(pRef.current, redo);
      transport.seek(next.position);
      setPosition(next.position);
      change(next);
    } catch (error) {
      report(String(error));
    }
  };
  const edit = (action: 'split' | 'clear' | 'trim' | 'fade') => {
    if (!pRef.current?.selection || recording || busy) return;
    try {
      pause();
      const id =
        pRef.current.selection?.trackId ||
        editingTrack ||
        pRef.current.tracks.find((t) => t.role === 'recording')?.id ||
        pRef.current.tracks[0]?.id;
      change(editSelection(pRef.current, action, id));
      setMenu(null);
    } catch (e) {
      report(String(e));
    }
  };
  const trimClip = (trackId: string, clipId: string, start: number, end: number) => {
    if (!pRef.current || recording || busy) return;
    try {
      pause();
      const clip = pRef.current.tracks
        .find((track) => track.id === trackId)
        ?.clips.find((clip) => clip.id === clipId);
      change(
        trimRegion(
          pRef.current,
          trackId,
          clipId,
          start,
          end,
          clip ? waveforms.get(clip.assetId)?.duration : undefined,
        ),
      );
    } catch (error) {
      report(String(error));
    }
  };
  const addTrack = async () => {
    if (!pRef.current || recording || busy) return;
    try {
      pause();
      setBusy(t('准备录音轨…', 'Preparing recording track…'));
      const prefix = t('录音轨 ', 'Recording ');
      let number = 1;
      while (pRef.current.tracks.some((track) => track.name === prefix + number)) number++;
      const p = addRecordingTrack(pRef.current, prefix + number);
      await commit(p);
      setArmedTrackId(p.tracks.at(-1)!.id);
    } catch (e) {
      report(String(e));
    } finally {
      setBusy('');
    }
  };
  const record = async (punch = false) => {
    if (recording) {
      await finalize();
      return;
    }
    if (audioDevices.status === 'permission-needed') {
      show('settings');
      return;
    }
    if (
      !pRef.current?.score ||
      pRef.current.score.tempoMissing ||
      busy ||
      audioDevices.routing ||
      audioDevices.status === 'detecting' ||
      devices.length === 0 ||
      selectedInputUnavailable
    )
      return;
    const p = pRef.current,
      target = p.tracks.find((t) => t.id === armedTrackId && t.role === 'recording');
    if (!target) {
      report(
        t(
          '请先新增录音轨，或点击音轨的 R 按钮设为待命。',
          'Add a recording track or arm one with its R button first.',
        ),
      );
      return;
    }
    try {
      pause();
      setBusy(t('连接音频输入…', 'Connecting audio input…'));
      await transport.ctx.resume();
      setInputClipped(false);
      setMeter(0);
      const waveform = new LiveWaveform();
      liveWaveform.current = waveform;
      const rec = new PCMRecorder(transport.ctx);
      recorder.current = rec;
      const inputChannels = channels.split(',').map(Number),
        input = await rec.open(device, inputChannels);
      rec.setMonitoring(monitor);
      rec.onMeter = (peak, _peaks, clipped) => {
        if (recorder.current !== rec) return;
        setMeter(peak);
        if (clipped) setInputClipped(true);
      };
      rec.onWaveform = (packet) => {
        if (recorder.current === rec) waveform.append(packet);
      };
      rec.onError = (message) => {
        report(message);
        void finalize(true);
      };
      const start = punch && p.selection ? p.selection.start : position,
        stop = punch && p.selection ? p.selection.end : projectDuration(p);
      if (stop - start < 0.02)
        throw Error(t('请把播放头放到结束之前', 'Move the playhead before the end'));
      const playingProject = clone(p);
      playingProject.loop = false;
      playingProject.tracks = playingProject.tracks.map((t) =>
        t.id === target.id ? { ...t, mute: true } : t,
      );
      transport.reference = cuePreferences.current.reference;
      transport.metronome = cuePreferences.current.metronome;
      const time = await transport.start(
        playingProject,
        start,
        (name) => setBusy(t('准备录音：', 'Preparing recording: ') + name),
        countIn,
        stop,
      );
      const active = newRecordingSession(
        p,
        target.id,
        start,
        transport.ctx.sampleRate,
        inputChannels.length,
        input.label || 'Audio input',
        latency,
      );
      session.current = active;
      await rec.arm(active, time, time + (stop - start) / p.speed);
      rec.onEnded = () => void finalize();
      setPosition(start);
      setCounting(countIn > 0);
      setPlaying(true);
      setRecording(true);
      setBusy('');
      setMenu(null);
      void navigator.storage?.persist?.();
    } catch (e) {
      recorder.current?.close();
      recorder.current = null;
      liveWaveform.current = null;
      session.current = null;
      transport.pause();
      setPlaying(false);
      setRecording(false);
      setBusy('');
      report(String(e));
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,select,textarea,[contenteditable="true"]') ||
        modal ||
        showLibrary
      )
        return;
      if (e.code === 'Space' && (e.target as HTMLElement).closest('button')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (recording) void finalize();
        else void play();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        history(e.shiftKey);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.isComposing &&
        canEdit
      ) {
        e.preventDefault();
        edit('clear');
      } else if (e.key === 'Escape') setMenu(null);
      else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void record(!!pRef.current?.selection);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    localStorage.setItem('dripping.inputChannels', channels);
    setInputStatus('');
  }, [device, channels]);
  useEffect(() => {
    if (modal === 'settings') void audioDevices.refresh();
  }, [modal, audioDevices.refresh]);
  const testInput = async () => {
    try {
      setProbing(true);
      const result = await probeInput(device, channels.split(',').map(Number));
      setInputStatus(
        `${result.name} · ${result.sampleRate || '—'} Hz · ${result.channels || '—'} ${t('通道', 'channels')}`,
      );
    } catch (e) {
      report(String(e));
      setInputStatus('');
    } finally {
      setProbing(false);
    }
  };
  const show = (value: typeof modal) => {
    if (recording || busy) return;
    pause();
    setMenu(null);
    setModal(value);
  };
  const createDemo = async () => {
    try {
      setBusy(t('准备示例练习…', 'Preparing example…'));
      const files = demoFiles(),
        p = await addFiles(
          newProject('Morning Drops'),
          files.map((file) => ({ file, role: guessRole(file.name) })),
          setBusy,
        );
      open(p);
    } catch (e) {
      report(String(e));
    } finally {
      setBusy('');
    }
  };
  const restoreRecording = async (s: RecordingSession) => {
    try {
      setBusy(t('恢复录音…', 'Recovering take…'));
      const p = await getProject(s.projectId);
      if (!p) throw Error(t('找不到对应项目', 'The recording project is missing'));
      const recovered = await finishTake(p, s.id, true);
      open(recovered);
      setRecoveries(await recoverySessions());
    } catch (e) {
      report(String(e));
    } finally {
      setBusy('');
    }
  };
  const currentTrack = project?.tracks.find((t) => t.id === trackId);
  const currentOccurrence = project?.score
    ? [...project.score.route]
        .reverse()
        .find((occurrence) => occurrence.q <= secondsToQ(position, project.scoreMap))
    : undefined;
  const currentMeter = currentOccurrence
    ? project?.score?.measures[currentOccurrence.measure]
    : project?.score?.measures[0];
  const pdfVisible =
    !!project && (!!project.pdfSource || !!project.scoreConversion) && (!project.score || viewPdf);
  const tempoReady = !!project?.score && !project.score.tempoMissing;
  const deviceControlsLocked = probing || checkingInput || audioDevices.routing,
    inputDevices = devices.filter((item) => item.kind === 'audioinput'),
    outputDevices = devices.filter((item) => item.kind === 'audiooutput'),
    selectedInputUnavailable =
      !!device &&
      inputDevices.some((item) => item.label) &&
      !inputDevices.some((item) => item.deviceId === device),
    inputName =
      inputDevices.find((item) => item.deviceId === device)?.label ||
      (device
        ? t('所选输入不可用', 'Selected input unavailable')
        : t('系统默认输入', 'System default input')),
    outputName =
      outputDevices.find((item) => item.deviceId === outputId)?.label ||
      (outputId
        ? t('所选输出不可用', 'Selected output unavailable')
        : t('系统默认输出', 'System default output')),
    routingStatus = {
      detecting: t('正在检测音频设备…', 'Detecting audio devices…'),
      automatic: t('已自动配对输入和输出', 'Input and output paired automatically'),
      manual: t(
        '使用手动选择；不会自动覆盖',
        'Using your manual choices; automatic switching is off',
      ),
      'permission-needed': t(
        '首次使用请授权，之后插入设备即可自动检测',
        'Allow audio access once to detect connected devices automatically',
      ),
      'no-device': t(
        '未发现 AE-20 / AE-30，可手动选择其他音频设备',
        'No AE-20 / AE-30 found; you can select other audio devices manually',
      ),
      'multiple-devices': t(
        '发现多台乐器，请手动选择输入和输出',
        'Multiple instruments found; select input and output manually',
      ),
      'input-only': t(
        '已选择乐器输入；未找到唯一对应输出，请手动选择',
        'Instrument input selected; choose an output because no unique match was found',
      ),
      'output-unsupported': t(
        '当前浏览器不能切换输出，请在系统声音设置中选择 AE-20',
        'This browser cannot switch outputs. Select your instrument in system sound settings',
      ),
      deferred: t(
        '输入检测或录音期间保持当前设备，结束后再处理设备变化',
        'Keeping current devices during input checks or recording; changes will apply afterwards',
      ),
      'input-disconnected': t(
        '所选输入已断开，请重新连接或手动选择',
        'Selected input disconnected; reconnect it or choose another input',
      ),
      'output-disconnected': t(
        '所选输出已断开，现使用系统默认输出',
        'Selected output disconnected; using the system default output',
      ),
      'switch-failed': t(
        '设备切换失败；输出仍以当前设备显示为准',
        'Device switch failed; the output shown below is the applied route',
      ),
      unavailable: t(
        '此浏览器无法访问音频设备，请使用支持录音的 HTTPS 页面',
        'Audio devices are unavailable; use a recording-capable browser on HTTPS',
      ),
    }[audioDevices.status];
  const canEdit = tempoReady && !!project?.selection && !recording && !busy;
  const selectionTrackId =
    project?.selection?.trackId ||
    editingTrack ||
    project?.tracks.find((track) => track.role === 'recording')?.id ||
    project?.tracks[0]?.id ||
    '';
  const selectionTrack = project?.tracks.find((track) => track.id === selectionTrackId),
    selectedRegion = selectionTrack?.clips.find((clip) => clip.id === project?.selection?.clipId),
    selectedRegionRange =
      selectedRegion && selectionTrack ? clipSelection(selectionTrack, selectedRegion) : null,
    wholeRegionSelected =
      !!project?.selection &&
      !!selectedRegionRange &&
      Math.abs(project.selection.start - selectedRegionRange.start) < 1e-7 &&
      Math.abs(project.selection.end - selectedRegionRange.end) < 1e-7;
  const deleteSelectionLabel = wholeRegionSelected
    ? t('删除片段', 'Delete region')
    : t('删除选中音频', 'Delete selected audio');
  const undoLabel = [t('撤销', 'Undo'), editLabel(project?.undo.at(-1)?.label, locale)]
      .filter(Boolean)
      .join(' · '),
    redoLabel = [t('重做', 'Redo'), editLabel(project?.redo.at(-1)?.label, locale)]
      .filter(Boolean)
      .join(' · ');
  const footerStatus =
    busy ||
    (saved === 'error'
      ? t('保存失败 · 可重试或导出备份', 'Save failed · retry or export a backup')
      : saved === 'saving'
        ? t('保存中…', 'Saving…')
        : t('已保存在此浏览器', 'Saved in this browser'));
  const modalFeedback = error ? (
    <div role="alert" className="error-banner modal-error">
      <span>{error}</span>
      {saved === 'error' && (
        <button disabled={recording || !!busy} onClick={() => void retrySave()}>
          {t('重试保存', 'Retry save')}
        </button>
      )}
      <button aria-label={t('关闭错误提示', 'Dismiss error')} onClick={() => setError('')}>
        ×
      </button>
    </div>
  ) : null;
  return (
    <div className={`app-shell ${project ? 'has-project' : ''}`}>
      <header className="app-header">
        <button
          className="brand-button"
          data-modal-focus-fallback
          onClick={async () => {
            if (recording || busy) return;
            pause();
            if (pRef.current) {
              clearTimeout(saveTimer.current);
              await persist(pRef.current).catch(() => {});
            }
            setLibrary(await listProjects());
            setShowLibrary(true);
          }}
          aria-label={t('项目库', 'Project library')}
        >
          <Brand />
        </button>
        {project && (
          <>
            <span className="header-divider" />
            <input
              className="project-title"
              aria-label={t('项目名称', 'Project name')}
              value={project.name}
              disabled={recording}
              onChange={(e) => change({ ...project, name: e.target.value })}
            />
            <span className="local-badge">{t('本地项目', 'LOCAL PROJECT')}</span>
          </>
        )}
        <div className="header-actions">
          <select
            className="language-select"
            aria-label="Language / 语言"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="en">EN</option>
            <option value="zh">中文</option>
          </select>
          <button
            className="icon-button theme-toggle"
            title={t('切换明暗主题', 'Switch theme')}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name="sun" />
          </button>
          {project && (
            <>
              <button
                aria-label={t('添加素材', 'Add files')}
                disabled={recording || !!busy}
                onClick={() => show('import')}
              >
                <span>＋</span> <span className="optional">{t('添加素材', 'Add files')}</span>
              </button>
              <button
                className="primary"
                disabled={recording || !!busy}
                onClick={() => show('export')}
              >
                <Icon name="export" />
                {t('导出', 'Export')}
              </button>
            </>
          )}
        </div>
      </header>
      {error && !modal && !showLibrary && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button aria-label={t('关闭错误提示', 'Dismiss error')} onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {update && !recording && !busy && (
        <div className="update-banner">
          {t(
            '新版本已就绪。保存后刷新即可使用。',
            'An update is ready. Save and reload to use it.',
          )}
          <button
            onClick={async () => {
              if (recording || busy) return;
              setBusy(t('更新前保存…', 'Saving before update…'));
              try {
                if (pRef.current) await commit(pRef.current);
                navigator.serviceWorker.addEventListener(
                  'controllerchange',
                  () => location.reload(),
                  { once: true },
                );
                update.postMessage('ACTIVATE_UPDATE');
              } catch {
                /* Save feedback offers retry; do not reload an unsaved project. */
              } finally {
                setBusy('');
              }
            }}
          >
            {t('更新', 'Update')}
          </button>
        </div>
      )}
      {!!recoveries.length && (
        <div className="recovery-banner">
          <span>{t('发现尚未完成保存的录音', 'Unfinished recordings are available')}</span>
          {recoveries.map((s) => (
            <div key={s.id}>
              <button disabled={!!busy} onClick={() => restoreRecording(s)}>
                {t('恢复', 'Recover')} {s.name}{' '}
              </button>
              {!s.frames && (
                <button
                  onClick={async () => {
                    await deleteSession(s.id);
                    setRecoveries(await recoverySessions());
                  }}
                >
                  {t('移除空录音', 'Remove empty take')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!project ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">A LITTLE, EVERY DAY.</span>
            <h1>
              {t('让每一次练习，', 'Give your practice')}
              <br />
              <em>{t('都有回响。', 'room to flow.')}</em>
            </h1>
            <p>
              {t(
                '打开乐谱，跟上伴奏，留下自己的演奏。',
                'Your score, your backing, your performance.',
              )}
              <br />
              {t('音乐就在这里，慢慢成形。', 'A quiet place to bring them together.')}
            </p>
            <div className="welcome-actions">
              <button
                className="primary large"
                onClick={() => setModal('new')}
                disabled={!ready || !!busy}
              >
                ＋ {t('新的练习', 'New practice')}
              </button>
              <button className="large" onClick={createDemo} disabled={!ready || !!busy}>
                {t('试用示例', 'Try an example')} <Icon name="chevron" />
              </button>
            </div>
            <span className="privacy-note">
              {t('无需账号 · 素材留在设备上', 'No account · Your files stay on your device')} ·{' '}
              <a href="https://github.com/soapisnotfat/dripping" target="_blank" rel="noreferrer">
                {t('源码 · AGPL', 'Source · AGPL')}
              </a>
            </span>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="art-ring" />
            <span className="art-note">𝄞</span>
            <div className="art-staff">
              {[0, 1, 2, 3, 4].map((i) => (
                <i key={i} />
              ))}
            </div>
            <span className="art-note-small">♫</span>
            <span className="art-label">01 / KEEP PRACTICING</span>
          </div>
          {!!library.length && (
            <section className="recent-projects">
              <div className="section-heading">
                <h2>{t('继续练习', 'Pick up where you left off')}</h2>
                <span>
                  {library.length} {t('个项目', 'projects')}
                </span>
              </div>
              <div className="project-grid">
                {library.map((p) => (
                  <button
                    className="project-card"
                    key={p.id}
                    onClick={async () => {
                      const current = await getProject(p.id);
                      if (current) open(current);
                    }}
                  >
                    <span className="project-card-mark">♪</span>
                    <strong>{p.name}</strong>
                    <span>
                      {p.score?.measures.length || 0} {t('小节', 'bars')} · {p.tracks.length}{' '}
                      {t('音轨', 'tracks')}
                    </span>
                    <small>{new Date(p.updatedAt).toLocaleDateString()}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      ) : (
        <>
          <div className="workspace-toolbar">
            <div className="piece-meta">
              <span className="eyebrow">{t('练习工作台', 'PRACTICE STUDIO')}</span>
              <h1>{project.score?.title || project.name}</h1>
              <span>
                {project.score?.composer ||
                  t('你的下一次进步，从这里开始。', 'Make a little progress today.')}
              </span>
            </div>
            <div className="workspace-actions">
              <button
                disabled={recording || !!busy || !tempoReady || !project.tracks.length}
                title={
                  !project.score && project.pdfSource
                    ? t('等待识谱完成', 'Waiting for recognition')
                    : !tempoReady
                      ? t('先输入明确谱面速度', 'Enter the score tempo first')
                      : undefined
                }
                onClick={() => show('alignment')}
              >
                <Icon name="align" />
                {t('对齐', 'Alignment')}
                <i className="status-dot" />
              </button>
              <button
                className="icon-button"
                aria-label={t('全屏', 'Fullscreen')}
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void document.documentElement.requestFullscreen?.();
                }}
              >
                <Icon name="expand" />
              </button>
            </div>
          </div>
          <section className="score-section">
            <div className="section-toolbar">
              <div className="toolbar-group">
                <span className="section-label">01 / {t('乐谱', 'SCORE')}</span>
                {project.score && (
                  <span className="subtle">
                    {project.score.measures.length} {t('小节', 'bars')}
                  </span>
                )}
                {project.score && project.score.parts.length > 1 && (
                  <select
                    aria-label={t('乐谱声部', 'Score part')}
                    disabled={recording || playing}
                    value={project.score.partId}
                    onChange={(e) => {
                      const score = parseScore(project.scoreXml!, e.target.value);
                      change(
                        scoreTempoProject({
                          ...project,
                          score,
                          referenceTrackId: undefined,
                          tracks: project.tracks.map((t) => ({ ...t, alignment: undefined })),
                        }),
                      );
                    }}
                  >
                    {project.score.parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="toolbar-group score-tools">
                {!pdfVisible && (
                  <>
                    <select
                      aria-label={t('播放指示', 'Cursor style')}
                      value={mode}
                      onChange={(e) => setMode(e.target.value as CursorMode)}
                    >
                      <option value="note">{t('跟随音符', 'Note cursor')}</option>
                      <option value="beat">{t('按拍', 'Beat cursor')}</option>
                      <option value="bar">{t('小节', 'Bar cursor')}</option>
                      <option value="continuous">{t('连续', 'Continuous')}</option>
                      <option value="off">{t('隐藏指示', 'Hidden')}</option>
                    </select>
                    <button
                      aria-pressed={followScore}
                      className={followScore ? 'active' : ''}
                      onClick={() => setFollowScore(!followScore)}
                    >
                      {t('跟随', 'Follow')}
                    </button>
                  </>
                )}
                <button
                  className="icon-button"
                  aria-label={
                    pdfVisible
                      ? t('缩小原 PDF', 'Zoom original PDF out')
                      : t('缩小谱面', 'Zoom score out')
                  }
                  onClick={() => setZoom((v) => Math.max(0.5, v - 0.1))}
                >
                  −
                </button>
                <span className="zoom-value">
                  {Math.round((pdfVisible ? zoom / 0.9 : zoom) * 100)}%
                </span>
                <button
                  className="icon-button"
                  aria-label={
                    pdfVisible
                      ? t('放大原 PDF', 'Zoom original PDF in')
                      : t('放大谱面', 'Zoom score in')
                  }
                  onClick={() => setZoom((v) => Math.min(1.7, v + 0.1))}
                >
                  ＋
                </button>
              </div>
            </div>
            {project.score && (
              <ScoreTempo
                key={project.id}
                bpm={project.score.tempo[0]?.bpm || 120}
                missing={!!project.score.tempoMissing}
                disabled={recording || playing || !!busy}
                locale={locale}
                onTempo={updateScoreTempo}
              />
            )}
            {project.score && project.scoreXml && (
              <ScorePitch
                xml={project.scoreXml}
                partId={project.score.partId}
                locale={locale}
                disabled={recording || playing || !!busy}
                onChange={updateNotation}
              />
            )}

            {!!project.score?.warnings.length && (
              <details className="score-notes">
                <summary>
                  {t('乐谱导入提示', 'Score import notes')} ({project.score.warnings.length})
                </summary>
                {project.score.warnings.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </details>
            )}
            {(project.pdfSource || project.scoreConversion) && project.score && (
              <button
                className="pdf-view-toggle"
                aria-pressed={viewPdf}
                onClick={() => setViewPdf(!viewPdf)}
              >
                {viewPdf
                  ? t('查看识别谱面', 'View recognized score')
                  : t('查看原 PDF', 'View original PDF')}
              </button>
            )}
            {(project.pdfSource || project.scoreConversion) && (!project.score || viewPdf) ? (
              <PdfSource
                project={project}
                locale={locale}
                zoom={zoom / 0.9}
                progress={
                  pdfActivity?.projectId === project.id &&
                  pdfActivity.sourceId === project.pdfSource?.id
                    ? pdfActivity.progress
                    : undefined
                }
                onRecognize={() => void startPdfRecognition()}
                onCancel={cancelPdfRecognition}
              />
            ) : (
              <ScoreView
                key={`${project.id}:${project.scoreXml}`}
                project={project}
                position={position}
                locale={locale}
                zoom={zoom}
                follow={followScore}
                onFollow={setFollowScore}
                mode={mode}
                onSeek={seek}
                onSelect={select}
                onContext={(x, y, noteId) => setMenu({ x, y, noteId })}
                onCorrectPitch={!recording && !playing && !busy ? correctPitch : undefined}
                onError={report}
              />
            )}
          </section>
          <div className="transport">
            <div className="transport-buttons">
              <button
                className="icon-button"
                aria-label={t('回到开头', 'Return to start')}
                disabled={recording || !!busy}
                onClick={() => seek(0)}
              >
                <Icon name="back" />
              </button>
              <button
                className="play-button"
                aria-label={playing ? t('暂停', 'Pause') : t('播放', 'Play')}
                disabled={!!busy || !tempoReady}
                onClick={() => (recording ? finalize() : play())}
              >
                <Icon name={playing ? 'pause' : 'play'} />
              </button>
              <button
                className={`record-button ${recording ? 'recording' : ''}`}
                aria-label={recording ? t('停止录音', 'Stop recording') : t('录音', 'Record')}
                title={
                  armedTrack
                    ? armedTrack.name
                    : t('先新增或待命一条录音轨', 'Add or arm a recording track first')
                }
                disabled={
                  !!busy ||
                  !tempoReady ||
                  (!recording &&
                    (!armedTrack ||
                      audioDevices.routing ||
                      audioDevices.status === 'detecting' ||
                      (devices.length === 0 && audioDevices.status !== 'permission-needed') ||
                      selectedInputUnavailable))
                }
                onClick={() => record(false)}
              >
                <span />
              </button>
              <button
                className={`icon-button ${project.loop ? 'active' : ''}`}
                title={t('循环选区', 'Loop selection')}
                aria-label={t('循环选区', 'Loop selection')}
                aria-pressed={project.loop}
                disabled={!project.selection || recording || !!busy}
                onClick={() => {
                  pause();
                  change({ ...project, loop: !project.loop });
                }}
              >
                <Icon name="loop" />
              </button>
            </div>
            <div className="transport-position">
              <strong>{positionLabel(position, project)}</strong>
              <span>
                {project.score
                  ? `${project.score.route.length} ${t('小节', 'bars')} · ${currentMeter?.beats || 4}/${currentMeter?.beatType || 4}`
                  : project.pdfSource
                    ? project.pdfSource.state === 'failed'
                      ? t('识别未完成，请重试', 'Recognition needs retry')
                      : t('等待识谱完成', 'Waiting for recognition')
                    : t('请添加乐谱', 'Add a score')}
              </span>
              <small
                className={`record-target ${armedTrack ? 'armed' : ''}`}
                title={armedTrack?.name}
              >
                {armedTrack
                  ? `${t('录入：', 'Record to: ')}${armedTrack.name}`
                  : t('先选择录音轨', 'Choose a recording track')}
              </small>
            </div>
            <div className="transport-speed">
              <span>{t('练习速度', 'TEMPO')}</span>
              <select
                aria-label={t('练习速度', 'Practice speed')}
                disabled={recording || !!busy}
                value={project.speed}
                onChange={(e) => {
                  pause();
                  change({ ...project, speed: Number(e.target.value) });
                }}
              >
                {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.5].map((v) => (
                  <option value={v} key={v}>
                    {Math.round(v * 100)}%
                  </option>
                ))}
              </select>
              <small>{t('保留音高', 'pitch preserved')}</small>
            </div>
            <div className="transport-options">
              <label className="check">
                <input
                  type="checkbox"
                  checked={metronome}
                  onChange={(e) => setMetronome(e.target.checked)}
                />
                {t('节拍器', 'Click')}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={reference}
                  disabled={!project.score}
                  onChange={(e) => setReference(e.target.checked)}
                />
                {t('谱面合成音', 'Score synth')}
              </label>
              <select
                aria-label={t('合成音色', 'Synth instrument')}
                value={instrument}
                disabled={playing || recording}
                title={t(
                  '仅用于谱面合成音，不改变导入录音',
                  'Only affects score synth; imported recordings keep their sound',
                )}
                onChange={(e) => {
                  setInstrument(e.target.value as 'flute' | 'piano');
                }}
              >
                <option value="flute">{t('长笛', 'Flute')}</option>
                <option value="piano">{t('钢琴', 'Piano')}</option>
              </select>
            </div>
            <button
              aria-label={t('音频设备', 'Audio devices')}
              title={`${inputName} → ${outputName} · ${routingStatus}`}
              className={`input-button ${recording ? 'live' : ''}`}
              disabled={recording || !!busy}
              onClick={() => show('settings')}
            >
              <Icon name="mic" />
              <span>
                {recording
                  ? counting
                    ? t('预备拍', 'Count in')
                    : t('正在录音', 'Recording')
                  : t('音频设备', 'Audio devices')}
              </span>
              <i style={{ '--level': `${Math.min(100, meter * 200)}%` } as React.CSSProperties} />
            </button>
          </div>
          <AudioLevels
            key={project.id}
            locale={locale}
            playing={playing}
            recording={recording}
            inputPeak={meter}
            inputClipped={inputClipped}
            gainDb={project.masterGainDb ?? 0}
            onGain={(db) => {
              if (pRef.current) {
                transport.setOutputGain(db);
                change({ ...pRef.current, masterGainDb: db });
              }
            }}
          />
          <section className="audio-section">
            <div className="section-toolbar">
              <div className="toolbar-group">
                <span className="section-label">02 / {t('音轨', 'TRACKS')}</span>
                <span className="subtle">{project.tracks.length}</span>
                <button
                  className="icon-button"
                  aria-label={undoLabel}
                  title={undoLabel}
                  disabled={!project.undo.length || recording || !!busy}
                  onClick={() => history()}
                >
                  <Icon name="undo" />
                </button>
                <button
                  className="icon-button"
                  aria-label={redoLabel}
                  title={redoLabel}
                  disabled={!project.redo.length || recording || !!busy}
                  onClick={() => history(true)}
                >
                  <Icon name="redo" />
                </button>
                <button disabled={recording || !!busy} onClick={addTrack}>
                  ＋ {t('录音轨', 'Recording track')}
                </button>
              </div>
              <div className="toolbar-group">
                <button
                  disabled={!canEdit}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.left, y: r.top });
                  }}
                >
                  {t('编辑选区', 'Edit selection')} ▾
                </button>
                <button
                  disabled={!canEdit}
                  onClick={() => edit('clear')}
                  title={`${deleteSelectionLabel} (Delete / Backspace) · ${t('可撤销', 'Undo available')}`}
                >
                  {deleteSelectionLabel}
                </button>
                <button
                  className={snap ? 'active' : ''}
                  aria-pressed={snap}
                  onClick={() => setSnap(!snap)}
                >
                  {t('按拍吸附', 'Snap')}
                </button>
                <button
                  className={followTimeline ? 'active' : ''}
                  aria-pressed={followTimeline}
                  onClick={() => setFollowTimeline(!followTimeline)}
                >
                  {t('跟随', 'Follow')}
                </button>
                <input
                  className="timeline-zoom"
                  aria-label={t('时间轴缩放', 'Timeline zoom')}
                  type="range"
                  min="12"
                  max="140"
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                />
              </div>
            </div>
            <SelectionEditor
              project={project}
              locale={locale}
              trackId={selectionTrackId}
              disabled={recording || !!busy || !tempoReady}
              onSelect={select}
            />
            <Timeline
              project={project}
              position={position}
              locale={locale}
              scale={scale}
              snap={snap}
              follow={followTimeline}
              waveforms={waveforms}
              recording={recording}
              playing={playing}
              counting={counting}
              locked={recording || !!busy}
              mixLocked={!!busy}
              armedTrackId={armedTrack?.id}
              activeRecording={recording || finishing.current ? session.current : null}
              liveWaveform={liveWaveform.current}
              inputPeak={meter}
              inputClipped={inputClipped}
              savingRecording={!recording && finishing.current}
              onArm={(id) => setArmedTrackId(armedTrackId === id ? '' : id)}
              onSeek={seek}
              onSelect={select}
              onTrack={trackChange}
              onTrim={trimClip}
              onContext={(x, y) => setMenu({ x, y })}
              onFollow={setFollowTimeline}
              onTrackSettings={(id) => {
                setTrackId(id);
                show('track');
              }}
            />
          </section>
          <footer className="app-footer">
            <span className={`save-status ${saved}`}>
              <i />
              {footerStatus}
              {saved === 'error' && (
                <button disabled={recording || !!busy} onClick={() => void retrySave()}>
                  {t('重试保存', 'Retry save')}
                </button>
              )}
            </span>
            <span>
              {recording
                ? t('输入原声单独保存', 'Dry input is being captured')
                : project.selection
                  ? `${t('选区', 'Selection')} ${musicalLabel(project.selection.start, project, locale)}—${musicalLabel(project.selection.end, project, locale)}`
                  : t(
                      '单击定位 · 拖动选范围 · 双击选整段',
                      'Click to seek · Drag for a range · Double-click for a whole region',
                    )}
            </span>
            <span>
              {project.score ? t('基准：谱面速度与拍号', 'Clock: score tempo and meter') : ''} ·{' '}
              <a href="https://github.com/soapisnotfat/dripping" target="_blank" rel="noreferrer">
                {t('源码 · AGPL', 'Source · AGPL')}
              </a>
            </span>
          </footer>
        </>
      )}
      {menu && project && (
        <>
          <div className="menu-dismiss" onPointerDown={() => setMenu(null)} />
          <div
            role="menu"
            className="edit-menu"
            style={{
              left: clamp(menu.x, 8, window.innerWidth - 278),
              top: clamp(menu.y - 20, 8, window.innerHeight - 370),
            }}
          >
            {menu.noteId && (
              <button role="menuitem" onClick={() => correctPitch(menu.noteId!)}>
                {t('校正音高…', 'Correct pitch…')}
              </button>
            )}
            <strong>{t('编辑选区', 'Edit selection')}</strong>
            <label>
              {t('音轨', 'Track')}
              <select
                value={project.selection?.trackId || editingTrack || project.tracks[0]?.id}
                onChange={(e) => {
                  setEditingTrack(e.target.value);
                  if (project.selection)
                    select({ ...project.selection, trackId: e.target.value, clipId: undefined });
                }}
              >
                {project.tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {(['split', 'clear', 'trim', 'fade'] as const).map((action, i) => (
              <button role="menuitem" disabled={!canEdit} key={action} onClick={() => edit(action)}>
                {
                  [
                    t('在选区边界切分', 'Split at selection edges'),
                    deleteSelectionLabel,
                    t('仅保留选区', 'Keep only selection'),
                    t('添加短淡入淡出', 'Add short fades'),
                  ][i]
                }
              </button>
            ))}
            <button role="menuitem" disabled={!canEdit || !armedTrack} onClick={() => record(true)}>
              {t('在待命音轨重录选区', 'Punch in to armed track')}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                select(null);
                setMenu(null);
              }}
            >
              {t('取消选区', 'Clear selection marker')}
            </button>
          </div>
        </>
      )}
      {(modal === 'new' || modal === 'import') && (
        <ImportDialog
          feedback={modalFeedback}
          locale={locale}
          project={modal === 'import' ? project || undefined : undefined}
          onOpen={open}
          onAdd={addImported}
          onClose={() => setModal(null)}
          onError={report}
        />
      )}
      {modal === 'alignment' && project && (
        <AlignmentDialog
          feedback={modalFeedback}
          project={project}
          locale={locale}
          initialTrack={trackId}
          onCommit={commit}
          onClose={() => {
            setModal(null);
            setPlaying(false);
          }}
          onError={report}
        />
      )}
      {modal === 'note-pitch' && pitchTarget && (
        <PitchCorrectionDialog
          initial={pitchTarget.pitch}
          measure={pitchTarget.measure}
          locale={locale}
          onClose={() => setModal(null)}
          onApply={(pitch) => {
            const current = pRef.current;
            if (!current || current.id !== pitchTarget.projectId || recording || playing || busy)
              throw Error(t('当前无法校正音高', 'Pitch correction is unavailable'));
            const updated = changeNotePitch(current, pitchTarget.id, pitch);
            if (updated !== current) change(updated);
          }}
        />
      )}
      {modal === 'export' && project && (
        <ExportDialog
          pendingAssets={Array.from(stagedAssets.current.get(project.id)?.values() || [])}
          feedback={modalFeedback}
          project={project}
          locale={locale}
          onClose={() => setModal(null)}
          onError={report}
        />
      )}
      {modal === 'settings' && (
        <Modal
          feedback={modalFeedback}
          title={t('音频设备', 'Audio devices')}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            {t(
              '录音仅采集所选输入。使用耳机，避免扬声器的伴奏被麦克风收到。',
              'Recording captures the selected input. Use headphones to keep speaker playback out of your microphone.',
            )}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={audioDevices.autoConnect}
              disabled={deviceControlsLocked}
              onChange={(e) => audioDevices.setAutoConnect(e.target.checked)}
            />
            {t(
              '插入 AE-20 / AE-30 时自动选择输入和输出',
              'Automatically select input and output when an AE-20 / AE-30 connects',
            )}
          </label>
          <p role="status" className="muted">
            {routingStatus}
          </p>
          {audioDevices.error && <p role="alert">{audioDevices.error}</p>}
          <div className="input-test">
            <button disabled={deviceControlsLocked} onClick={() => void audioDevices.authorize()}>
              {t('授权并检测音频设备', 'Allow audio access & detect devices')}
            </button>
            <button disabled={deviceControlsLocked} onClick={() => void audioDevices.refresh()}>
              {t('重新检测', 'Refresh devices')}
            </button>
            {typeof (navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })
              ?.selectAudioOutput === 'function' && (
              <button
                disabled={deviceControlsLocked || !audioDevices.supportsOutputSelection}
                onClick={() => void audioDevices.authorizeOutput()}
              >
                {t('授权输出设备', 'Allow an output device')}
              </button>
            )}
          </div>
          <p className="audio-route-summary">
            {t('当前输入：', 'Current input: ')}
            {inputName}
            <br />
            {t('当前输出：', 'Current output: ')}
            {outputName}
          </p>
          <label className="field">
            {t('输入设备', 'Input device')}
            <select
              aria-label={t('输入设备', 'Input device')}
              disabled={deviceControlsLocked}
              value={device}
              onChange={(e) => void audioDevices.selectInput(e.target.value)}
            >
              <option value="">{t('系统默认', 'System default')}</option>
              {device && !inputDevices.some((d) => d.deviceId === device) && (
                <option value={device}>
                  {t('所选设备不可用 · 请刷新', 'Selected input unavailable · refresh devices')}
                </option>
              )}
              {inputDevices.map((d, i) => (
                <option value={d.deviceId} key={d.deviceId}>
                  {d.label || `${t('音频输入', 'Audio input')} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('输出设备（伴奏和监听）', 'Output device (backing and monitoring)')}
            <select
              aria-label={t('输出设备', 'Output device')}
              disabled={deviceControlsLocked || !audioDevices.supportsOutputSelection}
              value={outputId}
              onChange={(e) => void audioDevices.selectOutput(e.target.value)}
            >
              <option value="">{t('系统默认', 'System default')}</option>
              {outputId && !outputDevices.some((item) => item.deviceId === outputId) && (
                <option value={outputId}>
                  {t('所选输出不可用', 'Selected output unavailable')}
                </option>
              )}
              {outputDevices
                .filter((item) => item.deviceId !== 'default')
                .map((item, i) => (
                  <option key={item.deviceId} value={item.deviceId}>
                    {item.label || `${t('音频输出', 'Audio output')} ${i + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              {t('输入通道', 'Input channels')}
              <select
                disabled={deviceControlsLocked}
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
              >
                <option value="0">{t('通道 1 · 单声道', 'Channel 1 · mono')}</option>
                <option value="1">{t('通道 2 · 单声道', 'Channel 2 · mono')}</option>
                <option value="0,1">{t('通道 1–2 · 立体声', 'Channels 1–2 · stereo')}</option>
              </select>
            </label>
            <label className="field">
              {t('预备拍数', 'Count-in beats')}
              <select value={countIn} onChange={(e) => setCountIn(Number(e.target.value))}>
                {[0, 2, 4, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="input-test">
            <button disabled={deviceControlsLocked} onClick={testInput}>
              {probing ? t('连接中…', 'Connecting…') : t('测试连接', 'Test connection')}
            </button>
            {inputStatus && <span role="status">{inputStatus}</span>}
          </div>
          <InputMeter
            device={device}
            channels={channels}
            locale={locale}
            onError={report}
            disabled={probing || audioDevices.routing}
            onRunningChange={setCheckingInput}
          />
          <label className="field">
            {t('录音向前补偿（毫秒）', 'Shift recording earlier (milliseconds)')}
            <DraftNumber
              key={recordingRouteKey(devices, device, outputId, channels)}
              label={t('录音向前补偿（毫秒）', 'Shift recording earlier (milliseconds)')}
              value={latency}
              min={-500}
              max={1000}
              invalidText={t(
                '请输入 −500 到 1000 之间的整数。',
                'Enter a whole number from −500 to 1000.',
              )}
              onCommit={(value) => {
                setLatency(value);
              }}
            />
          </label>
          <p className="muted">
            {savedForRoute
              ? t(
                  '已恢复这组输入、输出和通道的补偿设置。',
                  'Restored the saved correction for this input, output and channel combination.',
                )
              : t(
                  '这组设备尚未保存补偿。更换输入或输出后，不沿用其他设备的设置。',
                  'No correction saved for this route. Changing input or output does not reuse another route’s correction.',
                )}{' '}
            {t(
              '自动选设备不等于自动测量延迟。当前网页无法取得完整的输入硬件时间戳，因此不会声称已自动校准。补偿只调整新录音的位置，不消除现场监听延迟。',
              'Automatic device selection does not measure latency. This page lacks complete input hardware timestamps and does not claim automatic calibration. Correction moves new recordings; it does not remove live monitoring delay.',
            )}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={monitor}
              onChange={(e) => setMonitor(e.target.checked)}
            />
            {t(
              '录音时经浏览器回放输入声（耳机监听）',
              'Play input through the browser while recording (headphones)',
            )}
          </label>
          <p className="muted">
            {t(
              '已直接听到 AE-20 的声音时，可关闭此项，避免听到第二份延迟回放。关闭后仍会正常录音。',
              'If you already hear the AE-20 directly, leave this off to avoid a second delayed copy. Recording still works with monitoring off.',
            )}
          </p>
          <p className="muted">
            {t(
              '浏览器可用通道由设备和驱动决定。首次使用音频接口时，请先录一小段核对通道及时间偏移。',
              'Available input channels depend on the device and driver. Test a short take with your interface to check channels and timing.',
            )}
          </p>
          <footer>
            <button className="primary" onClick={() => setModal(null)}>
              {t('完成', 'Done')}
            </button>
          </footer>
        </Modal>
      )}
      {modal === 'track' && currentTrack && project && (
        <Modal
          feedback={modalFeedback}
          title={t('音轨设置', 'Track settings')}
          onClose={() => setModal(null)}
        >
          <label className="field">
            {t('名称', 'Name')}
            <input
              value={currentTrack.name}
              onChange={(e) => trackChange(trackId, { name: e.target.value })}
            />
          </label>
          <label className="field">
            {t('类型', 'Role')}
            <select
              disabled={!currentTrack.sourceAssetId}
              value={currentTrack.role}
              onChange={(e) => trackChange(trackId, { role: e.target.value as Track['role'] })}
            >
              <option value="backing">{t('伴奏', 'Backing')}</option>
              <option value="demo">{t('示范录音', 'Demo recording')}</option>
              <option value="recording">{t('录音', 'Recording')}</option>
            </select>
          </label>
          <label className="field">
            {t('声像', 'Pan')} · {currentTrack.pan.toFixed(2)}
            <input
              type="range"
              min="-1"
              max="1"
              step=".01"
              value={currentTrack.pan}
              onChange={(e) => trackChange(trackId, { pan: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            {t('整体偏移（拍）', 'Track offset (beats)')}
            <DraftNumber
              key={trackId}
              label={t('整体偏移（拍）', 'Track offset (beats)')}
              step={0.125}
              disabled={!project.score}
              value={Number(
                (
                  (secondsToQ(currentTrack.offset, project.scoreMap) *
                    (project.score?.measures[0].beatType || 4)) /
                  4
                ).toFixed(3),
              )}
              invalidText={t(
                '请输入有效拍数（最小步长 ⅛ 拍）。',
                'Enter a valid number of beats in ⅛-beat steps.',
              )}
              onCommit={(value) =>
                trackChange(trackId, {
                  offset: qToSeconds(
                    (value * 4) / (project.score?.measures[0].beatType || 4),
                    project.scoreMap,
                  ),
                })
              }
            />
          </label>
          <footer>
            <button
              onClick={() => {
                change(
                  editProject(project, 'remove track', (p) => {
                    p.tracks = p.tracks.filter((t) => t.id !== trackId);
                  }),
                );
                setModal(null);
              }}
            >
              {t('移除音轨（可撤销）', 'Remove track (undoable)')}
            </button>
            <button className="primary" onClick={() => setModal(null)}>
              {t('完成', 'Done')}
            </button>
          </footer>
        </Modal>
      )}
      {showLibrary && (
        <Modal
          feedback={modalFeedback}
          title={t('你的项目', 'Your projects')}
          onClose={() => setShowLibrary(false)}
          wide
        >
          <div className="library-actions">
            <button
              className="primary"
              onClick={() => {
                setShowLibrary(false);
                setModal('new');
              }}
            >
              ＋ {t('新的练习', 'New practice')}
            </button>
            <button
              onClick={() => {
                setShowLibrary(false);
                void createDemo();
              }}
            >
              {t('打开示例', 'Open example')}
            </button>
          </div>
          <div className="project-grid">
            {library.map((p) => (
              <button
                className="project-card"
                key={p.id}
                onClick={async () => {
                  const current = await getProject(p.id);
                  if (current) open(current);
                }}
              >
                <span className="project-card-mark">♪</span>
                <strong>{p.name}</strong>
                <span>
                  {p.tracks.length} {t('音轨', 'tracks')} · {p.takes.length} takes
                </span>
                <small>{new Date(p.updatedAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
          <p className="muted">
            {t(
              '项目保存在这个浏览器中。定期导出项目备份，可在其他设备恢复。',
              'Projects live in this browser. Export project backups to restore them on another device.',
            )}
          </p>
        </Modal>
      )}
      {busy && !project && (
        <div className="loading-toast" role="status">
          <i />
          {busy}
        </div>
      )}
    </div>
  );
}
