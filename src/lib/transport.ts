import type { Project, PCM, Track } from './types';
import { copyBuffer, toAudioBuffer, slicePCM } from './audio';
import { getAsset } from './storage';
import { audioJobs } from './jobs';
import { projectDuration, qToSeconds, secondsToQ } from './time';
import { referencePCM, metronomePCM } from './reference';
import { scoreTempoProject } from './score-time';
import { audibleTrackIds } from './mix';

type OutputAudioContext = AudioContext & {
  setSinkId?: (deviceId: string) => Promise<void>;
  readonly sinkId?: string | { type: string };
};

export class Transport {
  private context?: AudioContext;
  private outputQueue = Promise.resolve();
  private routedOutputId = '';
  readonly pcm = new Map<string, PCM>();
  private rendered = new Map<string, { key: string; buffer: AudioBuffer }>();
  private nodes: AudioBufferSourceNode[] = [];
  private clicks: OscillatorNode[] = [];
  private gains = new Map<string, GainNode>();
  private pans = new Map<string, StereoPannerNode>();
  private destination?: GainNode;
  private meters: AnalyserNode[] = [];
  private meterData: Float32Array<ArrayBuffer>[] = [];
  private startTime = 0;
  private origin = 0;
  private speed = 1;
  private end = 0;
  private loopRange?: { start: number; end: number };
  playing = false;
  reference = false;
  metronome = false;
  referenceInstrument: 'flute' | 'piano' = 'flute';
  referenceVolume = 0.65;
  get ctx() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.destination = this.context.createGain();
      this.destination.connect(this.context.destination);
      const split = this.context.createChannelSplitter(2);
      this.destination.connect(split);
      this.meters = [0, 1].map((channel) => {
        const meter = this.context!.createAnalyser();
        meter.fftSize = 4096;
        split.connect(meter, channel);
        return meter;
      });
      this.meterData = this.meters.map((meter) => new Float32Array(meter.fftSize));
    }
    return this.context;
  }
  get supportsOutputSelection() {
    const context = this.context as OutputAudioContext | undefined,
      prototype = typeof AudioContext === 'undefined' ? undefined : AudioContext.prototype;
    return (
      typeof (context?.setSinkId ?? (prototype as OutputAudioContext)?.setSinkId) === 'function'
    );
  }
  get outputDeviceId() {
    const sink = (this.context as OutputAudioContext | undefined)?.sinkId;
    return typeof sink === 'string' ? sink : this.routedOutputId;
  }
  setOutputDevice(deviceId: string): Promise<void> {
    // Serialize hot-plug/manual changes: an earlier slow switch must not win last.
    const task = this.outputQueue.then(async () => {
      if (!this.context && !deviceId) return;
      if (!this.supportsOutputSelection) {
        if (deviceId)
          throw Error(
            '浏览器不支持选择音频输出，请在系统声音设置中切换 / Choose the output in system sound settings; this browser cannot select an audio output',
          );
        return;
      }
      const context = this.ctx as OutputAudioContext;
      if (this.outputDeviceId === deviceId) return;
      await context.setSinkId!(deviceId);
      this.routedOutputId = deviceId;
    });
    // A denied or disconnected device must not prevent a later route change.
    this.outputQueue = task.catch(() => {});
    return task;
  }
  setOutputGain(db: number) {
    if (this.context)
      this.destination?.gain.setTargetAtTime(
        10 ** (Math.max(-36, Math.min(6, db)) / 20),
        this.context.currentTime,
        0.01,
      );
  }
  outputLevels() {
    let peak = 0,
      power = 0,
      count = 0;
    this.meters.forEach((meter, index) => {
      const data = this.meterData[index];
      meter.getFloatTimeDomainData(data);
      for (const value of data) {
        peak = Math.max(peak, Math.abs(value));
        power += value * value;
        count++;
      }
    });
    return { peak, rms: count ? Math.sqrt(power / count) : 0 };
  }
  async asset(id: string): Promise<PCM> {
    if (this.pcm.has(id)) return this.pcm.get(id)!;
    const asset = await getAsset(id),
      buffer = await this.ctx.decodeAudioData(await asset.blob.arrayBuffer());
    if (buffer.numberOfChannels > 2)
      throw Error('请导入单声道或立体声音频 / Import mono or stereo audio');
    const pcm = copyBuffer(buffer);
    this.pcm.set(id, pcm);
    return pcm;
  }
  async decode(file: Blob): Promise<PCM> {
    return copyBuffer(await this.ctx.decodeAudioData(await file.arrayBuffer()));
  }
  async auditionRaw(
    pcm: PCM,
    from: number,
    length: number,
    gainDb = 0,
  ): Promise<AudioBufferSourceNode> {
    this.pause();
    await this.ctx.resume();
    this.setOutputGain(gainDb);
    const start = Math.min(
        Math.max(0, from),
        Math.max(0, (pcm.channels[0].length - 1) / pcm.sampleRate),
      ),
      buffer = toAudioBuffer(slicePCM(pcm, start, start + length), this.ctx),
      source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.destination!);
    const now = this.ctx.currentTime,
      fade = Math.min(0.005, buffer.duration / 4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    gain.gain.setValueAtTime(1, now + buffer.duration - fade);
    gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
    source.addEventListener(
      'ended',
      () => {
        source.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
    this.nodes.push(source);
    source.start();
    return source;
  }
  async prepare(project: Project, onProgress?: (text: string) => void) {
    const duration = projectDuration(project),
      sr = this.ctx.sampleRate;
    for (const track of project.tracks) {
      if (!track.clips.length) {
        this.rendered.delete(track.id);
        continue;
      }
      const key = JSON.stringify([track.clips, track.offset, project.speed, duration]);
      if (this.rendered.get(track.id)?.key === key) continue;
      onProgress?.(track.name);
      const assetIds = [...new Set(track.clips.map((c) => c.assetId))];
      const buffers = await Promise.all(
        assetIds.map(async (id) => [id, await this.asset(id)] as [string, PCM]),
      );
      const pcm = await audioJobs.run<PCM>('render', {
        track,
        buffers,
        from: 0,
        to: duration,
        sampleRate: sr,
        speed: project.speed,
        mixed: false,
      });
      this.rendered.set(track.id, { key, buffer: toAudioBuffer(pcm, this.ctx) });
    }
    if (project.score) {
      const key = JSON.stringify([
        project.scoreXml,
        project.score.partId,
        project.scoreMap,
        project.speed,
        this.referenceInstrument,
        duration,
      ]);
      if (this.rendered.get('reference')?.key !== key) {
        const pcm = referencePCM(project, this.referenceInstrument);
        const rendered =
          project.speed === 1
            ? pcm
            : await audioJobs.run<PCM>('stretch', { pcm, speed: project.speed });
        this.rendered.set('reference', { key, buffer: toAudioBuffer(rendered, this.ctx) });
        this.rendered.set('metronome', {
          key,
          buffer: toAudioBuffer(metronomePCM(project, project.speed), this.ctx),
        });
      }
    }
  }
  async start(
    project: Project,
    from: number,
    onProgress?: (text: string) => void,
    countIn = 0,
    durationOverride?: number,
  ): Promise<number> {
    if (!project.score || project.score.tempoMissing)
      throw Error('先添加乐谱并确认谱面速度 / Add a score and confirm its tempo');
    project = scoreTempoProject(project);
    this.pause();
    await this.ctx.resume();
    await this.prepare(project, onProgress);
    this.origin = from;
    this.speed = project.speed;
    this.end = durationOverride ?? projectDuration(project);
    this.loopRange =
      project.loop && project.selection
        ? { start: project.selection.start, end: project.selection.end }
        : undefined;
    const q = secondsToQ(from, project.scoreMap),
      occurrence = project.score
        ? [...project.score.route].reverse().find((m) => m.q <= q)
        : undefined,
      beatQ = 4 / (occurrence ? project.score!.measures[occurrence.measure].beatType : 4);
    const beatSeconds = project.score
      ? qToSeconds(q + beatQ, project.scoreMap) - qToSeconds(q, project.scoreMap)
      : 0.625;
    const delay = (countIn * beatSeconds) / project.speed;
    this.startTime = this.ctx.currentTime + 0.18 + delay;
    for (let i = 0; i < countIn; i++)
      this.click(this.startTime - delay + (i * beatSeconds) / project.speed, i === 0);
    const add = (id: string, track?: Track) => {
      const rendered = this.rendered.get(id);
      if (!rendered) return;
      const node = this.ctx.createBufferSource(),
        gain = this.ctx.createGain(),
        pan = this.ctx.createStereoPanner();
      node.buffer = rendered.buffer;
      node.connect(gain).connect(pan).connect(this.destination!);
      if (this.loopRange) {
        node.loop = true;
        node.loopStart = this.loopRange.start / project.speed;
        node.loopEnd = this.loopRange.end / project.speed;
      }
      this.gains.set(id, gain);
      this.pans.set(id, pan);
      this.nodes.push(node);
      if (from / project.speed < node.buffer.duration)
        node.start(this.startTime, Math.max(0, from / project.speed));
      if (track) pan.pan.value = track.pan;
    };
    project.tracks.forEach((t) => add(t.id, t));
    if (project.score) {
      add('reference');
      add('metronome');
    }
    this.playing = true;
    this.updateMix(project);
    return this.startTime;
  }
  private click(at: number, accent: boolean) {
    const oscillator = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    oscillator.frequency.value = accent ? 1600 : 1100;
    gain.gain.setValueAtTime(0.2, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    oscillator.connect(gain).connect(this.destination!);
    oscillator.start(at);
    oscillator.stop(at + 0.05);
    this.clicks.push(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.clicks = this.clicks.filter((n) => n !== oscillator);
    };
  }
  updateMix(project: Project, recordingTrackId?: string) {
    this.setOutputGain(project.masterGainDb ?? 0);
    const audible = new Set(audibleTrackIds(project.tracks));
    for (const track of project.tracks) {
      this.gains
        .get(track.id)
        ?.gain.setTargetAtTime(
          audible.has(track.id) && track.id !== recordingTrackId ? track.volume : 0,
          this.ctx.currentTime,
          0.012,
        );
      this.pans.get(track.id)?.pan.setTargetAtTime(track.pan, this.ctx.currentTime, 0.012);
    }
    this.gains
      .get('reference')
      ?.gain.setTargetAtTime(this.reference ? this.referenceVolume : 0, this.ctx.currentTime, 0.01);
    this.gains
      .get('metronome')
      ?.gain.setTargetAtTime(this.metronome ? 0.6 : 0, this.ctx.currentTime, 0.01);
  }
  position(): number {
    if (!this.playing) return this.origin;
    const position = this.origin + Math.max(0, this.ctx.currentTime - this.startTime) * this.speed;
    if (this.loopRange && position >= this.loopRange.end)
      return (
        this.loopRange.start +
        ((position - this.loopRange.end) % (this.loopRange.end - this.loopRange.start))
      );
    return Math.min(position, this.end);
  }
  get finished() {
    return this.playing && !this.loopRange && this.position() >= this.end;
  }
  get countingIn() {
    return this.playing && this.ctx.currentTime < this.startTime;
  }
  pause(): number {
    const position = this.position();
    for (const n of [...this.nodes, ...this.clicks]) {
      try {
        n.stop();
      } catch {}
      n.disconnect();
    }
    this.nodes = [];
    this.clicks = [];
    this.gains.clear();
    this.pans.clear();
    this.playing = false;
    this.origin = position;
    return position;
  }
  seek(seconds: number) {
    this.origin = seconds;
  }
  reset() {
    this.pause();
    this.pcm.clear();
    this.rendered.clear();
    this.origin = 0;
  }
}
export const transport = new Transport();
