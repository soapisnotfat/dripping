import { useRef, useState } from 'react';
import { zip, strToU8 } from 'fflate';
import type { Project, Asset, PCM } from '../../lib/types';
import { renderExport, originalTake } from '../../lib/project';
import { exportProject, download, getAsset } from '../../lib/storage';
import { audioJobs } from '../../lib/jobs';
import { encodeWav, mixTracks } from '../../lib/audio';
import { projectDuration, musicalLabel } from '../../lib/time';
import { audibleTrackIds } from '../../lib/mix';
import { amplitudeDb, planMaster, type AudioStats, type MasterPlan } from '../../lib/master';
import { Modal } from './Modal';
import type { DialogProps } from './types';

export function ExportDialog({
  project,
  locale,
  onClose,
  onError,
  feedback,
  pendingAssets = [],
}: DialogProps & { project: Project; pendingAssets?: Asset[] }) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [busy, setBusy] = useState(''),
    [status, setStatus] = useState(''),
    [range, setRange] = useState(false),
    [selected, setSelected] = useState(() => audibleTrackIds(project.tracks)),
    [speed, setSpeed] = useState(1);
  const [bitDepth, setBitDepth] = useState<24 | 32>(24),
    [ceiling, setCeiling] = useState(-1),
    [matchLoudness, setMatchLoudness] = useState(false),
    [target, setTarget] = useState(-18);
  const [analysis, setAnalysis] = useState<{ key: string; stats: AudioStats } | null>(null),
    cache = useRef<{ key: string; pcm: PCM; stats: AudioStats } | null>(null);
  const audible = new Set(audibleTrackIds(project.tracks)),
    solo = project.tracks.some((track) => track.solo);
  const a = range && project.selection ? project.selection.start : 0,
    b = range && project.selection ? project.selection.end : projectDuration(project);
  const key = JSON.stringify([project.revision, selected, a, b, speed]),
    stats = analysis?.key === key ? analysis.stats : null;
  const settings = {
      gainDb: project.masterGainDb ?? 0,
      ceilingDb: ceiling,
      targetLufs: matchLoudness ? target : undefined,
    },
    plan = stats ? planMaster(stats, settings) : null;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100),
    db = (value: number) => (value > 0 ? amplitudeDb(value).toFixed(1) : '−∞');
  const getMix = async () => {
    if (cache.current?.key === key) return cache.current;
    if (!project.score || project.score.tempoMissing)
      throw Error(t('请先添加乐谱并确认谱面速度', 'Add a score and confirm its tempo first'));
    const tracks = project.tracks.filter((track) => selected.includes(track.id));
    if (!tracks.length) throw Error(t('至少选择一条音轨', 'Choose at least one track'));
    const rendered: PCM[] = [];
    for (const track of tracks) {
      setBusy(track.name);
      rendered.push(await renderExport(project, track, a, b, true, speed));
    }
    setBusy(t('分析响度与真峰值…', 'Analyzing loudness and true peak…'));
    const pcm = mixTracks(rendered),
      stats = await audioJobs.run<AudioStats>('measure-export', { pcm });
    const result = { key, pcm, stats };
    cache.current = result;
    setAnalysis({ key, stats });
    return result;
  };
  const analyze = async () => {
    try {
      setBusy(t('准备分析…', 'Preparing analysis…'));
      await getMix();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy('');
    }
  };
  const startDownload = (blob: Blob, name: string) => {
    download(blob, name);
    setStatus(t('已生成并开始下载：', 'Generated and download started: ') + name);
  };
  const perform = async (kind: 'stems' | 'mix' | 'project') => {
    try {
      setStatus('');
      setBusy(t('正在准备导出…', 'Preparing export…'));
      if (kind === 'project') {
        startDownload(
          await exportProject(project, pendingAssets),
          `${safe(project.name)}.drippingproj`,
        );
        return;
      }
      if (!project.score || project.score.tempoMissing)
        throw Error(t('请先添加乐谱并确认谱面速度', 'Add a score and confirm its tempo first'));
      const tracks = project.tracks.filter((track) => selected.includes(track.id));
      if (!tracks.length) throw Error(t('至少选择一条音轨', 'Choose at least one track'));
      if (kind === 'mix') {
        const { pcm, stats } = await getMix();
        setBusy(t('生成高品质 WAV…', 'Encoding WAV…'));
        const result = await audioJobs.run<{ wav: ArrayBuffer; plan: MasterPlan }>('master-wav', {
          pcm,
          stats,
          settings,
          bitDepth,
        });
        startDownload(
          new Blob([result.wav], { type: 'audio/wav' }),
          `${safe(project.name)} — mix.wav`,
        );
      } else {
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i < tracks.length; i++) {
          setBusy(tracks[i].name);
          const pcm = await renderExport(project, tracks[i], a, b, false, speed);
          files[`${String(i + 1).padStart(2, '0')} ${safe(tracks[i].name)}.wav`] = new Uint8Array(
            encodeWav(pcm, 32),
          );
        }
        files['session.json'] = strToU8(
          JSON.stringify(
            {
              project: project.name,
              range: { start: a, end: b },
              sampleRate: 48000,
              bitDepth: 32,
              format: 'IEEE float WAV',
              speed,
              masterGainDb: project.masterGainDb ?? 0,
              alignment: 'All files share the same zero and length',
              tracks: tracks.map((track) => ({
                name: track.name,
                role: track.role,
                volume: track.volume,
                pan: track.pan,
              })),
            },
            null,
            2,
          ),
        );
        const data = await new Promise<Uint8Array>((resolve, reject) =>
          zip(files, { level: 0 }, (error, out) => (error ? reject(error) : resolve(out))),
        );
        startDownload(
          new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
          `${safe(project.name)} — stems.zip`,
        );
      }
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal
      feedback={feedback}
      title={t('带走你的练习', 'Export your practice')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        {t(
          '混音默认 48 kHz／24-bit WAV；分轨为 48 kHz／32-bit float WAV，共同起点和长度。',
          'Mixes default to 48 kHz / 24-bit WAV. Stems use 48 kHz / 32-bit float WAV with a shared start and length.',
        )}
      </p>
      <button
        className="export-reset"
        disabled={!!busy}
        onClick={() => setSelected(audibleTrackIds(project.tracks))}
      >
        {t('按当前播放音轨选择', 'Select currently audible tracks')}
      </button>
      <div className="check-list">
        {project.tracks.map((track) => (
          <label key={track.id}>
            <input
              type="checkbox"
              disabled={!!busy}
              checked={selected.includes(track.id)}
              onChange={(event) =>
                setSelected((ids) =>
                  event.target.checked ? [...ids, track.id] : ids.filter((id) => id !== track.id),
                )
              }
            />
            <span>
              {track.name}
              <small className="export-track-state">
                {!track.clips.length
                  ? t('无片段', 'No clips')
                  : track.mute
                    ? t('已静音', 'Muted')
                    : solo && !track.solo
                      ? t('被其他轨独奏排除', 'Excluded by solo')
                      : track.solo
                        ? t('独奏', 'Solo')
                        : t('播放', 'Audible')}
                {selected.includes(track.id) && !audible.has(track.id)
                  ? t(' · 已手动加入导出', ' · explicitly included')
                  : ''}
              </small>
            </span>
          </label>
        ))}
      </div>
      <label className="field">
        {t('导出速度', 'Export speed')}
        <select
          disabled={!!busy}
          aria-label={t('导出速度', 'Export speed')}
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          <option value="1">{t('原速 · 100%', 'Original · 100%')}</option>
          {project.speed !== 1 && (
            <option value={project.speed}>
              {t('当前练习速度', 'Current practice speed')} · {Math.round(project.speed * 100)}%
            </option>
          )}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={range}
          disabled={!project.selection || !!busy}
          onChange={(event) => setRange(event.target.checked)}
        />
        {t('只导出选区', 'Export selection only')} · {musicalLabel(a, project, locale)}–
        {musicalLabel(b, project, locale)}
      </label>
      <div className="mix-quality">
        <label>
          {t('混音格式', 'Mix format')}
          <select
            aria-label={t('混音格式', 'Mix format')}
            disabled={!!busy}
            value={bitDepth}
            onChange={(event) => setBitDepth(Number(event.target.value) as 24 | 32)}
          >
            <option value="24">24-bit PCM WAV</option>
            <option value="32">32-bit float WAV</option>
          </select>
        </label>
        <label>
          {t('混音峰值上限', 'Mix peak ceiling')}
          <select
            aria-label={t('混音峰值上限', 'Mix peak ceiling')}
            disabled={!!busy}
            value={ceiling}
            onChange={(event) => setCeiling(Number(event.target.value))}
          >
            {[-1, -2, -3, -6].map((value) => (
              <option key={value} value={value}>
                {value} dBTP
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            disabled={!!busy}
            checked={matchLoudness}
            onChange={(event) => setMatchLoudness(event.target.checked)}
          />
          {t('匹配整体响度', 'Match integrated loudness')}
        </label>
        {matchLoudness && (
          <label>
            {t('目标响度', 'Target loudness')}
            <select
              aria-label={t('目标响度', 'Target loudness')}
              disabled={!!busy}
              value={target}
              onChange={(event) => setTarget(Number(event.target.value))}
            >
              {[-23, -20, -18, -16, -14].map((value) => (
                <option key={value} value={value}>
                  {value} LUFS
                </option>
              ))}
            </select>
          </label>
        )}
        {matchLoudness && (
          <small>
            {t(
              '以目标响度为准，替代主输出增益。',
              'The loudness target replaces main output gain.',
            )}
          </small>
        )}
      </div>
      <button disabled={!!busy || !selected.length} onClick={() => void analyze()}>
        {t('分析混音', 'Analyze mix')}
      </button>
      {plan && (
        <div className="mix-analysis" aria-label={t('预计导出电平', 'Planned export levels')}>
          <dl>
            <dt>{t('整体响度', 'Integrated loudness')}</dt>
            <dd>{plan.lufs === null ? '—' : `${plan.lufs.toFixed(1)} LUFS-I`}</dd>
            <dt>{t('真峰值估计', 'Estimated true peak')}</dt>
            <dd>{db(plan.truePeak)} dBTP</dd>
            <dt>{t('采样峰值', 'Sample peak')}</dt>
            <dd>{db(plan.samplePeak)} dBFS</dd>
            <dt>{t('最终混音增益', 'Final mix gain')}</dt>
            <dd>
              {plan.gainDb > 0 ? '+' : ''}
              {plan.gainDb.toFixed(1)} dB
            </dd>
          </dl>
          {plan.reductionDb > 0.01 && (
            <p>
              {t('为保留峰值余量，整体降低', 'Overall reduction for peak headroom: ')}{' '}
              {plan.reductionDb.toFixed(1)} dB{locale === 'zh' ? '。' : '.'}
            </p>
          )}
          {plan.targetLimited && (
            <p>
              {t(
                '峰值上限优先，响度低于所选目标。',
                'The peak ceiling takes priority; loudness stays below the selected target.',
              )}
            </p>
          )}
          {matchLoudness && plan.lufs === null && (
            <p>
              {t(
                '片段过短或无有效信号，未匹配响度。',
                'Too short or no gated signal; loudness matching is unavailable.',
              )}
            </p>
          )}
        </div>
      )}
      <p className="muted compact">
        {t(
          '混音套用推子、声像与主输出增益；峰值保护及响度匹配只改变整体增益，保留演奏动态。分轨不套用这些增益。仅导出勾选音轨，不包含谱面合成音和节拍器。',
          'Mixes apply faders, pan and main output gain. Peak protection and loudness matching use constant gain to preserve dynamics. Stems exclude these gains. Only checked tracks are exported; score synth and click are excluded.',
        )}
      </p>
      <footer className="wrap">
        <button disabled={!!busy || !selected.length} onClick={() => perform('stems')}>
          {t('分轨 WAV', 'WAV stems')}
        </button>
        <button disabled={!!busy || !selected.length} onClick={() => perform('mix')}>
          {t('混音 WAV', 'Mix WAV')}
        </button>
        <button className="primary" disabled={!!busy} onClick={() => perform('project')}>
          {t('完整项目备份', 'Project backup')}
        </button>
      </footer>
      <p className="export-status" role="status" aria-live="polite">
        {busy || status}
      </p>
      {(project.scoreXml || project.pdfSource) && (
        <details>
          <summary>{t('乐谱与来源文件', 'Score and source files')}</summary>
          {project.scoreXml && (
            <div className="take-row">
              <span>MusicXML</span>
              <button
                disabled={!!busy}
                onClick={() =>
                  startDownload(
                    new Blob([project.scoreXml!], {
                      type: 'application/vnd.recordare.musicxml+xml',
                    }),
                    `${safe(project.name)}.musicxml`,
                  )
                }
              >
                {t('下载 MusicXML', 'Download MusicXML')}
              </button>
            </div>
          )}
          {(project.scoreConversion?.originalAssetIds || project.pdfSource?.assetIds)?.map(
            (id, index) => (
              <div className="take-row" key={id}>
                <span>
                  {t('原始 PDF', 'Original PDF')} {index + 1}
                </span>
                <button
                  disabled={!!busy}
                  onClick={async () => {
                    try {
                      const asset =
                        pendingAssets.find((asset) => asset.id === id) || (await getAsset(id));
                      startDownload(asset.blob, asset.name);
                    } catch (error) {
                      onError(String(error));
                    }
                  }}
                >
                  {t('下载原 PDF', 'Download original PDF')}
                </button>
              </div>
            ),
          )}
        </details>
      )}
      {!!project.takes.length && (
        <details>
          <summary>
            {t('每次录音的原始干声', 'Original dry takes')} ({project.takes.length})
          </summary>
          {project.takes.map((take) => (
            <div className="take-row" key={take.id}>
              <span>
                {take.name} · {take.speed}× · {take.sampleRate / 1000} kHz · {take.channels} ch ·{' '}
                {take.interrupted ? t('已恢复', 'Recovered') : t('原始干声', 'Original dry audio')}
              </span>
              <button
                disabled={!!busy}
                onClick={async () => {
                  try {
                    startDownload(await originalTake(take.assetId), `${safe(take.name)} — dry.wav`);
                  } catch (error) {
                    onError(String(error));
                  }
                }}
              >
                {t('下载原声', 'Download dry')}
              </button>
            </div>
          ))}
        </details>
      )}
    </Modal>
  );
}
