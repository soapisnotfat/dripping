import { useEffect, useRef, useState } from 'react';
import type { Project, Asset, Alignment, PCM, Track } from '../../lib/types';
import { clone, uid } from '../../lib/types';
import { audioAsset, editProject, changeNotationInstrument } from '../../lib/project';
import { transport } from '../../lib/transport';
import { audioJobs } from '../../lib/jobs';
import { pairSourceAnchor, type Features } from '../../lib/alignment';
import { pairWithinAlignment } from '../../lib/alignment-edit';
import type { AlignmentProgress } from '../../lib/phrase-refinement';
import {
  scoreReference,
  alignmentMapSignature,
  reviewedDemoBasis,
  type ScoreReference,
} from '../../lib/score-reference';
import type { NotationInstrument } from '../../lib/score';
import { SourcePoint } from '../SourcePoint';
import { ScorePitch } from '../ScorePitch';
import { mono } from '../../lib/audio';
import {
  tempoMap,
  validateAnchors,
  qToSeconds,
  projectDuration,
  musicalPositionAt,
  musicalPositionSeconds,
  secondsToQ,
  type MusicalPosition,
  scorePositionLabel,
} from '../../lib/time';
import { MusicalEndpoint } from '../SelectionEditor';
import { Modal } from './Modal';
import type { DialogProps } from './types';

export function AlignmentDialog({
  project,
  locale,
  onClose,
  onError,
  onCommit,
  initialTrack,
  feedback,
}: DialogProps & {
  project: Project;
  onCommit: (p: Project, assets?: Asset[]) => Promise<void>;
  initialTrack?: string;
}) {
  const text = (zh: string, en: string) => (locale === 'zh' ? zh : en),
    score = project.score!,
    tempoReady = !!score && !score.tempoMissing;
  const available = project.tracks.filter(
    (track): track is Track & { sourceAssetId: string } =>
      track.role !== 'recording' && !!track.sourceAssetId,
  );
  const [id, setId] = useState(
      available.find((track) => track.id === initialTrack)?.id || available[0]?.id || '',
    ),
    track = available.find((track) => track.id === id);
  const [candidate, setCandidate] = useState<Alignment | undefined>(track?.alignment),
    [busy, setBusy] = useState(''),
    [status, setStatus] = useState(''),
    [cancellable, setCancellable] = useState(false),
    [auditioning, setAuditioning] = useState(false);
  const [references, setReferences] = useState<{
      selected: ScoreReference;
      backing: ScoreReference;
    } | null>(null),
    [pcm, setPCM] = useState<PCM | null>(null),
    [demoMaps, setDemoMaps] = useState<Record<string, string>>({});
  const [scoreAt, setScoreAt] = useState<MusicalPosition>({ location: '0', value: '1' }),
    [sourceAt, setSourceAt] = useState(0);
  const analysisSequence = useRef(0),
    analysisActive = useRef(false),
    automaticBase = useRef<Alignment | undefined>(
      track?.alignment?.method !== 'manual' ? track?.alignment : undefined,
    ),
    active = useRef({ id, xml: project.scoreXml }),
    previewId = useRef(`alignment-preview-${uid()}`);
  active.current = { id, xml: project.scoreXml };
  useEffect(
    () => () => {
      analysisSequence.current++;
      if (analysisActive.current) audioJobs.cancel();
      transport.pause();
      transport.reference = false;
      transport.pcm.delete(previewId.current);
    },
    [],
  );
  useEffect(() => {
    if (!auditioning) return;
    const timer = setInterval(() => {
      if (!transport.playing || transport.finished) {
        transport.pause();
        setAuditioning(false);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [auditioning]);
  useEffect(() => {
    let canceled = false;
    setReferences(null);
    Promise.all([scoreReference(project), scoreReference(project, true)])
      .then(([selected, backing]) => {
        if (!canceled) setReferences({ selected, backing });
      })
      .catch((error) => {
        if (!canceled) onError(String(error));
      });
    return () => {
      canceled = true;
    };
  }, [project.scoreXml, score.partId]);
  useEffect(() => {
    let canceled = false;
    setPCM(null);
    if (track)
      transport
        .asset(track.sourceAssetId)
        .then((value) => {
          if (!canceled) setPCM(value);
        })
        .catch((error) => {
          if (!canceled) onError(String(error));
        });
    return () => {
      canceled = true;
    };
  }, [track?.sourceAssetId]);
  useEffect(() => {
    let canceled = false;
    Promise.all(
      available
        .filter((track) => track.role === 'demo' && track.alignment)
        .map(async (track) => [track.id, await alignmentMapSignature(track.alignment!.anchors)]),
    ).then((entries) => {
      if (!canceled) setDemoMaps(Object.fromEntries(entries));
    });
    return () => {
      canceled = true;
    };
  }, [project.tracks]);
  const locked = !!busy || !references || !pcm,
    reference = track?.role === 'backing' ? references?.backing : references?.selected;
  const candidateReference =
    candidate?.reference?.kind === 'score-parts' ? references?.backing : references?.selected;
  const signatureCurrent =
    !!candidateReference &&
    candidate?.reference?.scoreSignature === candidateReference.signature &&
    (candidate.reference.kind !== 'demo' ||
      (!!candidate.reference.demoTrackId &&
        demoMaps[candidate.reference.demoTrackId] === candidate.reference.demoMapSignature));
  const evidenceReady =
    signatureCurrent &&
    candidate?.assessment?.decision === 'supported' &&
    !candidate.assessment.unverified?.length &&
    !candidate.assessment.unassessed?.length &&
    (candidateReference?.pitch !== 'unspecified' ||
      (candidate?.reference?.kind === 'demo' && candidate.reference.demoBasis === 'manual'));
  const manualReady =
    signatureCurrent &&
    candidate?.method === 'manual' &&
    (candidate.manualMode === 'local'
      ? (candidate.manualPairs?.length ?? 0)
      : (candidate.manualAnchors?.length ?? 0)) >= 2;
  const ready =
    tempoReady && !!candidate && (candidate.method === 'manual' ? manualReady : evidenceReady);
  const canPreview = tempoReady && signatureCurrent && !!candidate && candidate.anchors.length >= 2;
  const features = async (value: PCM) =>
    audioJobs.run<Features>('features', { samples: mono(value), sampleRate: 11025, hop: 0.12 });
  const current = (operation: { id: string; xml: string | undefined }) =>
    active.current.id === operation.id && active.current.xml === operation.xml;
  const analyze = async () => {
    if (!track || !pcm || !reference || !references || !tempoReady) return;
    const operation = { ...active.current },
      sequence = ++analysisSequence.current;
    try {
      transport.pause();
      setAuditioning(false);
      analysisActive.current = true;
      setCancellable(true);
      setBusy(text('核对谱面音符与原音…', 'Comparing score notes with source audio…'));
      setStatus('');
      const demo =
          track.role === 'backing'
            ? available.find(
                (other) =>
                  other.role === 'demo' &&
                  other.id !== id &&
                  reviewedDemoBasis(other.alignment, references.selected),
              )
            : undefined,
        demoBasis = demo ? reviewedDemoBasis(demo.alignment, references.selected) : null;
      const used = demo ? references.selected : reference;
      let result: Alignment;
      if (demo) {
        const demoPCM = await transport.asset(demo.sourceAssetId);
        if (
          !reviewedDemoBasis(
            demo.alignment,
            references.selected,
            demoPCM.channels[0].length / demoPCM.sampleRate,
          )
        )
          throw Error(
            text(
              '示范配对超出原音范围，请重新配对。',
              'Demo pairs are outside the recorded source; pair them again.',
            ),
          );
        const audio = await features(pcm),
          demoAudio = await features(demoPCM);
        result = await audioJobs.run<Alignment>('align-demo', {
          score: used.score,
          demo: demoAudio,
          demoMap: demo.alignment!.anchors,
          features: audio,
        });
        result.assessment = await audioJobs.run<NonNullable<Alignment['assessment']>>(
          'assess-alignment',
          {
            score: used.score,
            features: audio,
            alignment: result,
            sampleRate: pcm.sampleRate,
            demo: demoAudio,
            demoMap: demo.alignment!.anchors,
          },
        );
      } else {
        const samples = mono(pcm),
          analyzed = await audioJobs.run<{
            alignment: Alignment | null;
            landmarks: number;
            attacks: number;
            analyzed: number;
          }>(
            'align-phrases',
            { score: used.score, samples, sampleRate: 11025, sourceSampleRate: pcm.sampleRate },
            (value) => {
              if (sequence !== analysisSequence.current || !current(operation)) return;
              const progress = value as AlignmentProgress,
                labels = {
                  features: text('提取原音起音与音高…', 'Extracting source attacks and pitch…'),
                  phrases: text('识别谱面乐句…', 'Recognizing score phrases…'),
                  refine: text('核查完整谱面内容', 'Checking full score content'),
                  verify: text('验证逐处音符对应…', 'Verifying individual note correspondence…'),
                };
              setBusy(
                labels[progress.phase] +
                  (progress.total
                    ? ` · ${Math.round(((progress.completed || 0) / progress.total) * 100)}%`
                    : ''),
              );
            },
            [samples.buffer as ArrayBuffer],
          );
        if (!analyzed.alignment) {
          if (sequence === analysisSequence.current && current(operation)) {
            setCandidate(undefined);
            setStatus(
              text(
                '没有找到足够的连续谱面内容。请核对素材版本，或试听原音后人工配对。',
                'No sufficient continuous score content was found. Check the arrangement, or audition the source and pair manually.',
              ),
            );
          }
          return;
        }
        result = analyzed.alignment;
      }
      const assessment = result.assessment!;
      if (used.pitch === 'unspecified' && !demo) {
        assessment.decision = 'review';
        assessment.reasons.push('notation-pitch-unspecified');
      }
      const points = assessment.points;
      assessment.points =
        points.length <= 128
          ? points
          : Array.from(
              { length: 128 },
              (_, index) => points[Math.round((index * (points.length - 1)) / 127)],
            );
      result.reference = {
        kind: demo ? 'demo' : used.kind,
        scoreSignature: used.signature,
        partIds: used.parts.map((part) => part.id),
        pitch: used.pitch,
        sampleRate: pcm.sampleRate,
        ...(demo
          ? {
              demoTrackId: demo.id,
              demoMapSignature: await alignmentMapSignature(demo.alignment!.anchors),
              demoBasis: demoBasis!,
            }
          : {}),
      };
      result.warnings = [...result.warnings, ...used.warnings];
      if (sequence !== analysisSequence.current || !current(operation)) return;
      automaticBase.current = clone(result);
      setCandidate(result);
      setStatus(
        assessment.decision === 'supported'
          ? text(
              '已生成全谱对齐候选。试听开头、各段起点和结尾，再应用。',
              'Score alignment candidate ready. Audition the opening, passage starts and ending before applying.',
            )
          : text(
              '部分内容仍待核或存在歧义，可以试听候选；自动应用尚未开放。',
              'Some content is unverified or ambiguous. Audition the candidate; automatic application remains unavailable.',
            ),
      );
    } catch (error) {
      if (sequence === analysisSequence.current) onError(String(error));
    } finally {
      if (sequence === analysisSequence.current) {
        analysisActive.current = false;
        setBusy('');
        setCancellable(false);
      }
    }
  };
  const cancelAnalysis = () => {
    analysisSequence.current++;
    analysisActive.current = false;
    audioJobs.cancel();
    setBusy('');
    setCancellable(false);
    setStatus(text('分析已取消，音轨没有改变。', 'Analysis canceled. The track is unchanged.'));
  };

  const manual = () => {
    if (!references || !pcm) return;
    transport.pause();
    setAuditioning(false);
    automaticBase.current = undefined;
    setCandidate({
      anchors: tempoMap(score),
      anchorSources: tempoMap(score).map(() => 'extrapolated' as const),
      manualAnchors: [],
      manualPairs: [],
      manualMode: 'points',
      method: 'manual',
      status: 'candidate',
      warnings: [],
      reference: {
        kind: 'manual',
        scoreSignature: references.selected.signature,
        partIds: references.selected.parts.map((part) => part.id),
        pitch: references.selected.pitch,
        sampleRate: pcm.sampleRate,
      },
    });
    setStatus(
      text(
        '配对至少两处实际听到的谱面位置。默认谱速只提供起始曲线。',
        'Pair at least two score positions heard in the source. Score tempo only supplies a starting curve.',
      ),
    );
  };
  const anchors = candidate?.anchors || [];
  const choose = (q: number, seconds: number) => {
    transport.pause();
    setAuditioning(false);
    setScoreAt(musicalPositionAt(qToSeconds(q, project.scoreMap), score, project.scoreMap));
    setSourceAt(seconds);
  };
  const addAnchor = () => {
    if (!candidate || !references || !pcm) return;
    transport.pause();
    setAuditioning(false);
    try {
      const q = secondsToQ(
        musicalPositionSeconds(scoreAt, score, project.scoreMap),
        project.scoreMap,
      );
      if (sourceAt < 0 || sourceAt >= pcm.channels[0].length / pcm.sampleRate)
        throw Error(text('请选择原音中的实际位置', 'Choose a point inside the recorded source'));
      if (candidate.manualMode === 'local' || candidate.method !== 'manual') {
        setCandidate(
          pairWithinAlignment(
            candidate,
            q,
            sourceAt,
            score.totalQ,
            pcm.channels[0].length / pcm.sampleRate,
          ),
        );
        setStatus(
          text(
            '局部配对已暂存；两处实点只重建区间内的对应，区间外保持不变。',
            'Local pair held. Two source points rebuild only their interval; exterior timing stays intact.',
          ),
        );
        return;
      }
      const edited =
          candidate.manualAnchors ??
          (candidate.method === 'manual' && anchors.length <= 32
            ? anchors.map((anchor) => anchor.q)
            : []),
        paired = pairSourceAnchor(score.totalQ, anchors, edited, q, sourceAt);
      setCandidate({
        ...candidate,
        ...paired,
        manualMode: 'points',
        manualPairs: paired.manualAnchors.map((q) => ({
          q,
          seconds: qToSeconds(q, paired.anchors),
        })),
        anchorSources: paired.anchors.map((point) =>
          paired.manualAnchors.includes(point.q) ? 'manual' : 'extrapolated',
        ),
        method: 'manual',
        status: 'candidate',
        assessment: undefined,
        reference: {
          kind: 'manual',
          scoreSignature: references.selected.signature,
          partIds: references.selected.parts.map((part) => part.id),
          pitch: references.selected.pitch,
          sampleRate: pcm.sampleRate,
        },
      });
    } catch (error) {
      onError(String(error));
    }
  };
  const removePoint = (index: number) => {
    if (!candidate || index <= 0 || index >= anchors.length - 1) return;
    transport.pause();
    setAuditioning(false);
    const q = anchors[index].q,
      next = clone(candidate);
    next.anchors = anchors.filter((_, at) => at !== index);
    next.anchorSources = next.anchorSources?.filter((_, at) => at !== index);
    next.manualAnchors = next.manualAnchors?.filter((at) => Math.abs(at - q) > 1e-7);
    next.manualPairs = next.manualPairs?.filter((point) => Math.abs(point.q - q) > 1e-7);
    next.manualMode = next.manualMode || (candidate.method === 'manual' ? 'points' : 'local');
    next.method = 'manual';
    next.status = 'candidate';
    if (next.assessment) {
      next.assessment.decision = 'review';
      next.assessment.reasons = [
        ...new Set([...next.assessment.reasons, 'manual-source-correction']),
      ];
    }
    setCandidate(next);
  };
  const removePair = (q: number) => {
    if (!candidate) return;
    transport.pause();
    setAuditioning(false);
    const next = clone(candidate);
    next.manualPairs = next.manualPairs?.filter((point) => Math.abs(point.q - q) > 1e-7);
    next.manualAnchors = next.manualAnchors?.filter((at) => Math.abs(at - q) > 1e-7);
    if (!next.manualPairs?.length && next.manualMode === 'local' && automaticBase.current) {
      setCandidate(clone(automaticBase.current));
      return;
    }
    const index = next.anchors.findIndex((point) => Math.abs(point.q - q) < 1e-7);
    if (index >= 0 && next.anchorSources?.[index] === 'manual') {
      if (index === 0 || index === next.anchors.length - 1)
        next.anchorSources[index] = 'extrapolated';
      else {
        next.anchors.splice(index, 1);
        next.anchorSources.splice(index, 1);
      }
    }
    next.status = 'candidate';
    setCandidate(next);
  };
  const render = async (allowReview = false) => {
    if (!candidate || !track || !(allowReview ? canPreview : ready))
      throw Error(
        text(
          '先核实自动内容证据，或配对至少两处原音位置',
          'Verify automatic content evidence or pair at least two source points first',
        ),
      );
    validateAnchors(candidate.anchors);
    return audioJobs.run<PCM>('conform', {
      pcm: await transport.asset(track.sourceAssetId),
      sourceMap: candidate.anchors,
      targetMap: project.scoreMap,
      duration: projectDuration(project),
      score,
      manualAnchors:
        candidate.manualAnchors ??
        (candidate.method === 'manual' && candidate.anchors.length <= 32
          ? candidate.anchors.map((anchor) => anchor.q)
          : []),
    });
  };
  const conform = async () => {
    if (!candidate || !track || !ready) return;
    const operation = { ...active.current };
    try {
      setBusy(text('按谱面保调校正…', 'Aligning to the score, preserving pitch…'));
      transport.pause();
      const rendered = await render();
      if (!current(operation)) return;
      const asset = audioAsset(project, rendered, `${track.name} — aligned.wav`),
        duration = projectDuration(project);
      const next = editProject(project, 'align to score', (p) => {
        const tr = p.tracks.find((track) => track.id === operation.id)!;
        tr.offset = 0;
        tr.clips = [
          {
            id: uid(),
            assetId: asset.id,
            label: track.name,
            start: 0,
            end: duration,
            sourceStart: 0,
            rate: 1,
            gain: 1,
            fadeIn: 0.005,
            fadeOut: 0.005,
          },
        ];
        tr.alignment = { ...candidate, status: 'accepted' };
      });
      next.assetIds.push(asset.id);
      transport.pcm.set(asset.id, rendered);
      await onCommit(next, [asset]);
      if (!current(operation)) return;
      setCandidate({ ...candidate, status: 'accepted' });
      setStatus(
        text(
          '已按谱面对齐。原始素材保留，可撤销。',
          'Aligned to the score. Original audio is retained; undo is available.',
        ),
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy('');
    }
  };
  const preview = async () => {
    if (auditioning) {
      transport.pause();
      setAuditioning(false);
      setStatus(text('试听已停止。', 'Audition stopped.'));
      return;
    }
    if (!track || !canPreview) return;
    const operation = { ...active.current };
    try {
      setBusy(text('准备对齐试听…', 'Preparing aligned audition…'));
      const rendered = await render(true);
      if (!current(operation)) return;
      transport.pcm.set(previewId.current, rendered);
      const p = clone(project);
      p.tracks = p.tracks.map((other) => ({
        ...other,
        mute: other.id !== id,
        solo: false,
        offset: 0,
        clips:
          other.id === id
            ? [
                {
                  id: 'preview',
                  assetId: previewId.current,
                  label: other.name,
                  start: 0,
                  end: projectDuration(p),
                  sourceStart: 0,
                  rate: 1,
                  gain: 1,
                  fadeIn: 0,
                  fadeOut: 0,
                },
              ]
            : other.clips,
      }));
      p.loop = false;
      transport.reference = true;
      await transport.start(p, musicalPositionSeconds(scoreAt, score, project.scoreMap));
      setAuditioning(true);
      setStatus(
        ready
          ? text('正在试听候选与谱面合成音。', 'Auditioning the candidate with score synth.')
          : text(
              '正在试听尚待核的候选，音轨没有改变。',
              'Auditioning the unverified candidate; the track is unchanged.',
            ),
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy('');
    }
  };
  const notation = async (instrument: NotationInstrument) => {
    transport.pause();
    setAuditioning(false);
    try {
      setBusy(text('更新记谱音高…', 'Updating notation pitch…'));
      await onCommit(changeNotationInstrument(project, instrument));
      setCandidate(undefined);
      setStatus(
        text(
          '记谱音高已更新，请重新分析。音色不变。',
          'Notation pitch updated. Analyze again; synth timbre is unchanged.',
        ),
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy('');
    }
  };
  const reason = (code: string) =>
    ({
      'unsupported-score-notes': text('部分音符还需核对', 'Some notes still need checking'),
      'not-fully-analyzed': text(
        '部分谱面范围尚未分析完',
        'Some score ranges are not fully analyzed',
      ),
      'ambiguous-phrase-chain': text(
        '找到多个相似乐段，请试听确认位置',
        'Several passages could match',
      ),
      'nonmonotone-refinement': text(
        '局部音符对应顺序冲突',
        'Local note correspondences conflict in order',
      ),
      'manual-source-correction': text(
        '已人工修正，原有待核范围仍保留',
        'Manually corrected; prior unverified ranges remain',
      ),
      'no-note-evidence': text('没有可用音符证据', 'No usable note evidence'),
      'too-few-note-attacks': text('音符入口太少', 'Too few note attacks'),
      'unresolved-note-entries': text(
        '相邻音符的位置尚未区分',
        'Adjacent note positions are unresolved',
      ),
      'large-timing-difference': text(
        '演奏顺序或速度差异需核对',
        'Review the performance route or large timing difference',
      ),
      'weak-note-attacks': text('音高与起音证据不足', 'Weak pitch and attack evidence'),
      'weak-opening': text('开头对应不足', 'Weak opening correspondence'),
      'weak-ending': text('结尾对应不足', 'Weak ending correspondence'),
      'weak-phrase-entry': text(
        '乐句入口不能可靠对应',
        'Phrase entries do not reliably correspond',
      ),
      'repeated-prefix-candidates': text('有多个相似乐句位置', 'Multiple similar phrase locations'),
      'weak-pitch-match': text('音高匹配较弱', 'Weak pitch match'),
      'ambiguous-shared-passages': text(
        '伴奏里找到多个相似乐段，请试听确认位置',
        'Several backing passages could match',
      ),
      'weak-shared-accompaniment': text(
        '示范与伴奏的共同内容不足',
        'Insufficient shared demo/backing content',
      ),
      'weak-bridge-boundaries': text(
        '共同伴奏的首尾对应不足',
        'Weak shared-accompaniment boundaries',
      ),
      'low-shared-structure': text(
        '共同内容缺少可区分的音乐变化',
        'Shared content has too little distinctive musical variation',
      ),
      'notation-pitch-unspecified': text(
        '请先确认谱面记谱音高',
        'Confirm the score notation pitch first',
      ),
    })[code] || code;
  const noteName = (midi: number) => {
    const rounded = Math.round(midi),
      name =
        ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][
          ((rounded % 12) + 12) % 12
        ] +
        (Math.floor(rounded / 12) - 1),
      cents = Math.round((midi - rounded) * 100);
    return name + (cents ? ` ${cents > 0 ? '+' : ''}${cents}¢` : '');
  };
  const atQ = () => {
      try {
        return secondsToQ(
          musicalPositionSeconds(scoreAt, score, project.scoreMap),
          project.scoreMap,
        );
      } catch {
        return 0;
      }
    },
    q = atQ(),
    bar = [...score.route].reverse().find((bar) => bar.q <= q) || score.route[0],
    beat = 4 / score.measures[bar.measure].beatType,
    step = (qToSeconds(q + beat, project.scoreMap) - qToSeconds(q, project.scoreMap)) / 8;
  const shownAnchors = anchors
    .map((anchor, index) => ({ anchor, index }))
    .filter(
      ({ anchor, index }) =>
        anchors.length <= 256 ||
        index === 0 ||
        index === anchors.length - 1 ||
        Math.abs(anchor.q - q) <= Math.max(beat * 8, bar.duration * 2) ||
        candidate?.manualAnchors?.includes(anchor.q),
    );
  return (
    <Modal
      feedback={feedback}
      title={text('乐谱与音频对齐', 'Score & audio alignment')}
      onClose={() => {
        if (!busy) {
          transport.pause();
          transport.reference = false;
          onClose();
        }
      }}
      wide
    >
      <div className="alignment-top">
        <label className="field">
          {text('音轨', 'Track')}
          <select
            disabled={!!busy}
            value={id}
            onChange={(event) => {
              transport.pause();
              setAuditioning(false);
              setId(event.target.value);
              setCandidate(available.find((track) => track.id === event.target.value)?.alignment);
              const aligned = available.find((track) => track.id === event.target.value)?.alignment;
              automaticBase.current = aligned?.method !== 'manual' ? aligned : undefined;
              setSourceAt(0);
              setStatus('');
            }}
          >
            {available.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={locked || !track || !tempoReady} onClick={analyze}>
          {text('自动匹配', 'Analyze audio')}
        </button>
        <button disabled={locked || !track || !tempoReady} onClick={manual}>
          {text('人工配对', 'Pair manually')}
        </button>
      </div>
      <p className="muted">
        {text(
          '自动匹配使用谱面音符、实际音高和演奏顺序，对应原始音频内容。小节、拍号与速度始终来自谱面。',
          'Automatic matching compares score notes, sounding pitch and performance route with source audio. Bars, meter and tempo always come from the score.',
        )}
      </p>
      {project.scoreXml && (
        <ScorePitch
          xml={project.scoreXml}
          partId={score.partId}
          locale={locale}
          disabled={!!busy}
          onChange={(instrument) => void notation(instrument)}
        />
      )}
      {!tempoReady && (
        <p className="warning">
          {text(
            '请先在谱面速度中输入明确的 BPM，再分析音频。',
            'Enter the score BPM before analyzing audio.',
          )}
        </p>
      )}
      {reference && (
        <p className="alignment-reference">
          {text('可用谱面声部：', 'Available score reference: ')}
          {reference.parts.map((part) => part.name).join(' · ')}
          {track?.role === 'backing' && reference.kind === 'score-part'
            ? text(
                '。只有旋律谱；伴奏若不含旋律，需要已核对的示范桥接。',
                '. Melody-only score: accompaniment without that melody needs a reviewed demo bridge.',
              )
            : ''}
        </p>
      )}
      <div className="status-line" role="status">
        {busy ||
          status ||
          text(
            '选择自动匹配，或试听原音后人工配对。',
            'Analyze the source, or audition it and pair points manually.',
          )}
        {cancellable && (
          <button onClick={cancelAnalysis}>{text('取消分析', 'Cancel analysis')}</button>
        )}
      </div>
      {candidate && (
        <>
          {!signatureCurrent && (
            <p className="warning">
              {text(
                '此候选缺少当前谱面的内容依据，请重新分析或人工配对。',
                'This candidate has no current score-content provenance. Analyze again or pair manually.',
              )}
            </p>
          )}
          {candidate.reference && (
            <p className="alignment-reference">
              {text('候选依据：', 'Candidate basis: ')}
              {candidate.reference.kind === 'demo'
                ? candidate.reference.demoBasis === 'manual'
                  ? text(
                      '沿用人工确认示范的位置，并核查共同伴奏',
                      'Shared accompaniment checked against a manually confirmed demo map',
                    )
                  : text('已核对示范的共同伴奏内容', 'Shared accompaniment with a reviewed demo')
                : candidate.reference.kind === 'manual'
                  ? text('人工配对原音与谱面', 'Manually paired source and score')
                  : candidate.reference.partIds
                      .map((id) => score.parts.find((part) => part.id === id)?.name || id)
                      .join(' · ')}
            </p>
          )}
          {candidate.assessment && (
            <div className="alignment-evidence">
              <strong>
                {candidate.assessment.decision === 'supported'
                  ? text(
                      '已找到内容证据，仍需试听核对',
                      'Content evidence found; audition to review',
                    )
                  : text('尚不能确认自动对应', 'Automatic correspondence is unconfirmed')}
              </strong>
              {candidate.assessment.reasons.map((code) => (
                <p className="warning" key={code}>
                  {reason(code)}
                </p>
              ))}
              <small>
                {text(
                  '下列位置是分析得到的试听线索，不是逐音准确率。',
                  'These are analysis-derived audition cues, not a note-accuracy score.',
                )}
              </small>
              <div className="evidence-points">
                {candidate.assessment.points.map((point, index) => (
                  <button
                    key={index}
                    disabled={locked}
                    onClick={() =>
                      choose(
                        point.q,
                        point.sourceSample /
                          (candidate.reference?.sampleRate || pcm?.sampleRate || 1),
                      )
                    }
                  >
                    {scorePositionLabel(point.q, score, locale)}
                    {point.midi.length ? ` · ${point.midi.map(noteName).join('/')}` : ''}
                    {point.support < 0.55 ? ' ?' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          {candidate.assessment &&
            [
              ['unverified', candidate.assessment.unverified],
              ['unassessed', candidate.assessment.unassessed],
            ].map(([kind, list]) => {
              const ranges = list as { from: number; to: number }[] | undefined;
              return (
                !!ranges?.length && (
                  <div className="alignment-ranges" key={kind as string}>
                    <strong>
                      {kind === 'unverified'
                        ? text('已分析，内容仍待核', 'Analyzed; content remains unverified')
                        : text('尚未完成分析', 'Not yet fully analyzed')}
                    </strong>
                    <div>
                      {ranges.map((range, index) => (
                        <button
                          key={index}
                          disabled={locked}
                          onClick={() =>
                            choose(range.from, qToSeconds(range.from, candidate.anchors))
                          }
                        >
                          {scorePositionLabel(range.from, score, locale)}–
                          {scorePositionLabel(range.to, score, locale)}
                        </button>
                      ))}
                    </div>
                    <small>
                      {text(
                        '点选可试听估计位置；这里尚未确认音符对应。',
                        'Choose a range to audition its estimated location; note correspondence is unconfirmed here.',
                      )}
                    </small>
                  </div>
                )
              );
            })}
          {!!candidate.manualPairs?.length && (
            <div className="manual-pairs">
              <strong>{text('人工原音配对', 'Manual source pairs')}</strong>
              {candidate.manualPairs.map((point) => (
                <div key={point.q}>
                  <button disabled={locked} onClick={() => choose(point.q, point.seconds)}>
                    {scorePositionLabel(point.q, score, locale)} · {text('人工点', 'Manual point')}
                  </button>
                  <button
                    disabled={locked}
                    aria-label={text('移除人工配对', 'Remove manual pair')}
                    onClick={() => removePair(point.q)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {candidate.manualMode === 'local' && (
            <p className="muted">
              {text(
                '两处实点只重建它们之间的区间，区间外保持不变。人手配对不代表其余待核音符已确认。',
                'Two source pairs rebuild only their interval; exterior timing stays intact. Manual pairs do not confirm other unverified notes.',
              )}
            </p>
          )}
          {pcm && (
            <SourcePoint
              key={track?.sourceAssetId}
              pcm={pcm}
              position={sourceAt}
              step={step}
              disabled={locked}
              locale={locale}
              gainDb={project.masterGainDb ?? 0}
              onPosition={setSourceAt}
              onError={onError}
            />
          )}
          <div className="anchor-add">
            <MusicalEndpoint
              name="score"
              label={text('谱面位置', 'Score position')}
              position={scoreAt}
              score={score}
              map={project.scoreMap}
              locale={locale}
              disabled={locked}
              onChange={setScoreAt}
            />
            <button
              disabled={
                locked ||
                !pcm ||
                sourceAt < 0 ||
                sourceAt >= pcm.channels[0].length / pcm.sampleRate
              }
              onClick={addAnchor}
            >
              {text('配对此处原音', 'Pair this source point')}
            </button>
            <button disabled={locked || !canPreview} onClick={preview}>
              {auditioning
                ? text('停止对齐试听', 'Stop alignment audition')
                : text('试听对齐结果', 'Audition alignment')}
            </button>
          </div>
          {candidate.method === 'manual' && !manualReady && (
            <p className="muted">
              {text(
                '至少需要两处人工配对，才能校正音轨。',
                'Pair at least two source points before aligning the track.',
              )}
            </p>
          )}
          {candidate.warnings.map((warning) => (
            <p className="warning" key={warning}>
              {warning}
            </p>
          ))}
          <details>
            <summary>{text('对齐曲线与人工配对点', 'Alignment curve and paired points')}</summary>
            {anchors.length > 256 && (
              <p className="muted">
                {text(
                  '显示所选小节附近的对应。更改谱面位置可查看其他乐段。',
                  'Showing correspondence near the selected bar. Change the score position to inspect another passage.',
                )}
              </p>
            )}
            <div className="anchor-table">
              <table>
                <thead>
                  <tr>
                    <th>{text('谱面小节·拍', 'Score bar · beat')}</th>
                    <th>{text('原始音频', 'Original source')}</th>
                    <th>{text('来源', 'Basis')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shownAnchors.map(({ anchor, index }) => (
                    <tr key={index}>
                      <td>{scorePositionLabel(anchor.q, score, locale)}</td>
                      <td>
                        <button disabled={locked} onClick={() => choose(anchor.q, anchor.seconds)}>
                          {text('在波形中核对', 'Review on waveform')}
                          {candidate.manualAnchors?.some((q) => Math.abs(q - anchor.q) < 1e-7)
                            ? ' •'
                            : ''}
                        </button>
                      </td>
                      <td>
                        {candidate.anchorSources?.[index] === 'manual'
                          ? text('人工', 'Manual')
                          : candidate.anchorSources?.[index] === 'extrapolated'
                            ? text('外推', 'Extrapolated')
                            : text('自动', 'Automatic')}
                      </td>
                      <td>
                        <button
                          disabled={locked || index === 0 || index === anchors.length - 1}
                          aria-label={text('删除对齐点', 'Remove anchor')}
                          onClick={() => removePoint(index)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <footer>
            <button className="primary" disabled={locked || !ready} onClick={conform}>
              {text('将本轨对齐到谱面', 'Align track to score')}
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
