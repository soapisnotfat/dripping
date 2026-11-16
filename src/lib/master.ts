import type { PCM } from './types';
import { encodeWav } from './audio';

export type AudioStats = { samplePeak: number; truePeak: number; rms: number; lufs: number | null };
export type MasterSettings = { gainDb: number; ceilingDb: number; targetLufs?: number };
export type MasterPlan = {
  gainDb: number;
  reductionDb: number;
  samplePeak: number;
  truePeak: number;
  lufs: number | null;
  targetLimited: boolean;
};
export const amplitudeDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
export const gainFromDb = (db: number) => 10 ** (db / 20);

// ITU-R BS.1770-5 Annexes 1 and 2, at the fixed 48 kHz export rate.
// https://www.itu.int/rec/R-REC-BS.1770
const truePeakFilter = [
  [0.001708984375, -0.0291748046875, -0.0189208984375, -0.00830078125],
  [0.010986328125, 0.029296875, 0.0330810546875, 0.014892578125],
  [-0.0196533203125, -0.0517578125, -0.0582275390625, -0.026611328125],
  [0.033203125, 0.089111328125, 0.1015625, 0.047607421875],
  [-0.0594482421875, -0.16650390625, -0.2003173828125, -0.102294921875],
  [0.1373291015625, 0.465087890625, 0.77978515625, 0.97216796875],
  [0.97216796875, 0.77978515625, 0.465087890625, 0.1373291015625],
  [-0.102294921875, -0.2003173828125, -0.16650390625, -0.0594482421875],
  [0.047607421875, 0.1015625, 0.089111328125, 0.033203125],
  [-0.026611328125, -0.0582275390625, -0.0517578125, -0.0196533203125],
  [0.014892578125, 0.0330810546875, 0.029296875, 0.010986328125],
  [-0.00830078125, -0.0189208984375, -0.0291748046875, 0.001708984375],
];
export function measureExport(pcm: PCM): AudioStats {
  const frames = pcm.channels[0]?.length ?? 0,
    step = 4800;
  if (
    pcm.sampleRate !== 48000 ||
    !pcm.channels.length ||
    pcm.channels.length > 2 ||
    pcm.channels.some((channel) => channel.length !== frames)
  )
    throw Error('Mix analysis requires 48 kHz mono/stereo PCM');
  const energy = new Float64Array(Math.ceil(frames / step));
  let peak = 0,
    truePeak = 0,
    power = 0;
  for (const channel of pcm.channels) {
    let s1 = 0,
      s2 = 0,
      h1 = 0,
      h2 = 0,
      sum = 0,
      block = 0;
    for (let i = 0; i < frames; i++) {
      const x = channel[i];
      if (!Number.isFinite(x)) throw Error('音频含无效采样 / Audio contains invalid samples');
      peak = Math.max(peak, Math.abs(x));
      power += x * x;
      const shelf = 1.53512485958697 * x + s1;
      s1 = -2.69169618940638 * x + 1.69065929318241 * shelf + s2;
      s2 = 1.19839281085285 * x - 0.73248077421585 * shelf;
      const weighted = shelf + h1;
      h1 = -2 * shelf + 1.99004745483398 * weighted + h2;
      h2 = shelf - 0.99007225036621 * weighted;
      sum += weighted * weighted;
      if ((i + 1) % step === 0) {
        energy[block++] += sum;
        sum = 0;
      }
    }
    // Include the FIR tail so a peak at the very end is not missed.
    for (let i = 0; i < frames + 11; i++) {
      let p0 = 0,
        p1 = 0,
        p2 = 0,
        p3 = 0;
      for (let tap = 0; tap < 12; tap++) {
        const value = channel[i - tap] || 0,
          c = truePeakFilter[tap];
        p0 += value * c[0];
        p1 += value * c[1];
        p2 += value * c[2];
        p3 += value * c[3];
      }
      truePeak = Math.max(truePeak, Math.abs(p0), Math.abs(p1), Math.abs(p2), Math.abs(p3));
    }
  }
  // 400 ms blocks, 75% overlap, -70 LUFS absolute and -10 LU relative gates.
  const blocks: number[] = [],
    absolute = 10 ** ((-70 + 0.691) / 10);
  for (let block = 0; block + 4 <= Math.floor(frames / step); block++) {
    const value =
      (energy[block] + energy[block + 1] + energy[block + 2] + energy[block + 3]) / (4 * step);
    if (value > absolute) blocks.push(value);
  }
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const threshold = blocks.length ? average(blocks) / 10 : Infinity,
    gated = blocks.filter((value) => value > threshold);
  return {
    samplePeak: peak,
    truePeak: Math.max(peak, truePeak),
    rms: frames ? Math.sqrt(power / (frames * pcm.channels.length)) : 0,
    lufs: gated.length ? -0.691 + 10 * Math.log10(average(gated)) : null,
  };
}
export function planMaster(stats: AudioStats, settings: MasterSettings): MasterPlan {
  if (
    !Number.isFinite(settings.gainDb) ||
    settings.gainDb < -60 ||
    settings.gainDb > 18 ||
    !Number.isFinite(settings.ceilingDb) ||
    settings.ceilingDb < -12 ||
    settings.ceilingDb > -1 ||
    (settings.targetLufs !== undefined &&
      (!Number.isFinite(settings.targetLufs) ||
        settings.targetLufs < -36 ||
        settings.targetLufs > -9))
  )
    throw Error('无效输出电平 / Invalid output level');
  const requested =
    settings.targetLufs !== undefined && stats.lufs !== null
      ? settings.targetLufs - stats.lufs
      : settings.gainDb;
  // Annex 2's 4x estimator can under-read between samples. Reserve 0.7 dB,
  // in addition to the chosen ceiling, rather than using a dynamics limiter.
  const maximum =
      stats.truePeak > 0 ? settings.ceilingDb - amplitudeDb(stats.truePeak) - 0.70001 : Infinity,
    gainDb = Math.min(requested, maximum),
    gain = gainFromDb(gainDb);
  return {
    gainDb,
    reductionDb: Math.max(0, requested - gainDb),
    samplePeak: stats.samplePeak * gain,
    truePeak: stats.truePeak * gain,
    lufs: stats.lufs === null ? null : stats.lufs + gainDb,
    targetLimited: settings.targetLufs !== undefined && requested > maximum + 0.01,
  };
}
export function masterWav(
  pcm: PCM,
  stats: AudioStats,
  settings: MasterSettings,
  bitDepth: 24 | 32,
) {
  const plan = planMaster(stats, settings);
  // One constant gain preserves dynamics. Encoding leaves all cached/source PCM intact.
  return { wav: encodeWav(pcm, bitDepth, gainFromDb(plan.gainDb)), plan };
}
