import {
  newProject,
  getAsset,
  readSession,
  saveProject,
  exportProject,
  importProject,
  deleteProject,
  recoverySessions,
  createSession,
  saveChunk,
} from '../src/lib/storage';
import {
  addFiles,
  guessRole,
  newRecordingSession,
  finishTake,
  editSelection,
  renderExport,
} from '../src/lib/project';
import { demoFiles } from '../src/lib/demo';
import { transport } from '../src/lib/transport';
import { audioJobs } from '../src/lib/jobs';
import { mono, encodeWav, resamplePCM } from '../src/lib/audio';
import type { Alignment } from '../src/lib/types';
import type { Features } from '../src/lib/alignment';
import { PCMRecorder } from '../src/lib/recorder';
import { qToSeconds, tempoMap } from '../src/lib/time';
const output = document.querySelector('#results')!,
  button = document.querySelector<HTMLButtonElement>('#run')!;
const assert = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
const log = (text: string) => {
  output.textContent += '\n' + text;
};
button.onclick = async () => {
  button.disabled = true;
  output.textContent = 'Running…';
  const ids: string[] = [];
  let recorder: PCMRecorder | undefined;
  try {
    const sourceRate = 44100,
      frequency = 18000,
      samples = Float32Array.from(
        { length: sourceRate },
        (_, i) => 0.2 * Math.sin((2 * Math.PI * frequency * i) / sourceRate),
      ),
      source = { sampleRate: sourceRate, channels: [samples] };
    const resampled = await resamplePCM(source, 48000),
      amplitude = (samples: Float32Array, rate: number) => {
        let re = 0,
          im = 0;
        const from = Math.round(0.2 * rate),
          to = Math.round(0.8 * rate);
        for (let i = from; i < to; i++) {
          re += samples[i] * Math.cos((2 * Math.PI * frequency * i) / rate);
          im += samples[i] * Math.sin((2 * Math.PI * frequency * i) / rate);
        }
        return (2 * Math.hypot(re, im)) / (to - from);
      };
    const resampledAmplitude = amplitude(resampled.channels[0], 48000);
    assert(
      resampled.channels[0].length === 48000 && Math.abs(resampledAmplitude - 0.2) < 0.01,
      `Resampling failed: amplitude ${resampledAmplitude}, frames ${resampled.channels[0].length}`,
    );
    log(
      `PASS: 44.1 → 48 kHz band-limited resampling retains 18 kHz amplitude ${resampledAmplitude.toFixed(6)} (source 0.2), exactly 48,000 frames`,
    );
    await transport.ctx.resume();
    let p = newProject('Temporary browser verification');
    ids.push(p.id);
    p = await addFiles(
      p,
      demoFiles().map((file) => ({ file, role: guessRole(file.name) })),
      () => {},
    );
    assert(
      p.score?.measures.length === 16 && p.tracks.length === 2,
      'Import did not preserve score and audio',
    );
    const demo = await transport.asset(p.tracks[1].sourceAssetId!),
      features = await audioJobs.run<Features>('features', {
        samples: mono(demo),
        sampleRate: 11025,
        hop: 0.12,
      });
    const alignment = await audioJobs.run<Alignment>('align', { score: p.score, features });
    const expected = tempoMap(p.score!),
      errors = [0, 4, 8, 12, 24, 28, 32, 34, 38, 42, 46, 50, 54, 58]
        .map((q) => Math.abs(qToSeconds(q, alignment.anchors) - qToSeconds(q, expected) - 0.55))
        .sort((a, b) => a - b);
    assert(errors[Math.floor(errors.length / 2)] < 0.15, 'Alignment median error exceeds 150 ms');
    log(
      `PASS: MusicXML + 2 audio files; actual worker alignment median error ${Math.round(errors[Math.floor(errors.length / 2)] * 1000)} ms`,
    );
    const sr = transport.ctx.sampleRate,
      synthetic = transport.ctx.createMediaStreamDestination(),
      input = transport.ctx.createOscillator(),
      gain = transport.ctx.createGain();
    input.frequency.value = 440;
    gain.gain.value = 0.15;
    input.connect(gain).connect(synthetic);
    input.start();
    recorder = new PCMRecorder(transport.ctx);
    await recorder.open('', [0], synthetic.stream);
    const s = newRecordingSession(p, 'test-recording-track', 2, sr, 1, 'Synthetic 440 Hz input', 0);
    s.speed = 0.75;
    const start = transport.ctx.currentTime + 0.2,
      end = start + 0.6;
    const done = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Recorder did not finish')), 5000);
      recorder!.onEnded = () => {
        clearTimeout(timeout);
        resolve();
      };
      recorder!.onError = (m) => {
        clearTimeout(timeout);
        reject(Error(m));
      };
    });
    await recorder.arm(s, start, end);
    await done;
    input.stop();
    const raw = await readSession(s.id),
      frames = raw.channels[0].length;
    assert(Math.abs(frames - 0.6 * sr) <= 2, 'Capture lost or added frames');
    let power = 0;
    for (const v of raw.channels[0]) power += v * v;
    assert(Math.sqrt(power / frames) > 0.08, 'Input recording is silent');
    p = await finishTake(p, s.id);
    assert(
      p.takes.length === 1 && p.tracks[2].clips[0].rate === 1 / 0.75,
      'Slow-practice take timing incorrect',
    );
    assert(
      !(await recoverySessions()).some((r) => r.id === s.id),
      'Committed take still appears as a recovery',
    );
    log(
      `PASS: real AudioWorklet captured ${frames} dry PCM frames; take stored at 75% practice speed`,
    );
    const asset = await getAsset(p.takes[0].assetId),
      wav = new DataView(await asset.blob.arrayBuffer());
    assert(
      wav.getUint16(20, true) === 3 && wav.getUint16(34, true) === 32,
      'Original take is not float32 WAV',
    );
    const recoveredSession = newRecordingSession(
      p,
      'recovered-track',
      4,
      sr,
      1,
      'Synthetic interrupted input',
      0,
    );
    await createSession(recoveredSession);
    await saveChunk(recoveredSession.id, 0, [raw.channels[0].slice(0, 4096)]);
    p = await finishTake(p, recoveredSession.id, true);
    assert(p.takes.at(-1)?.interrupted, 'Recovery not labeled');
    log('PASS: interrupted recording chunks recover as a separate take');
    p.selection = { start: 2.1, end: 2.2, trackId: p.tracks[2].id };
    p = editSelection(p, 'clear', p.tracks[2].id);
    await saveProject(p);
    const dryBefore = await asset.blob.arrayBuffer();
    assert(p.tracks[2].clips.length === 2, 'Clear did not keep the surrounding audio');
    const restored = await importProject(await exportProject(p));
    ids.push(restored.id);
    assert(
      restored.takes.length === 2 && restored.undo.length === p.undo.length,
      'Project restore lost takes or undo history',
    );
    const dryAfter = await (await getAsset(restored.takes[0].assetId)).blob.arrayBuffer();
    assert(
      dryBefore.byteLength === dryAfter.byteLength &&
        new Uint8Array(dryBefore).every((b, i) => b === new Uint8Array(dryAfter)[i]),
      'Backup changed dry take bytes',
    );
    log('PASS: edited project + history + original take backup round-trip, byte-for-byte');
    const stemA = await renderExport(restored, restored.tracks[0], 1, 3),
      stemB = await renderExport(restored, restored.tracks[2], 1, 3);
    assert(
      stemA.channels[0].length === 96000 && stemB.channels[0].length === 96000,
      'Stem lengths differ',
    );
    const exported = await transport.ctx.decodeAudioData(encodeWav(stemB, 32));
    log(
      `Decoded export: ${exported.length} frames / ${exported.sampleRate} Hz / ${exported.duration}s`,
    );
    assert(
      Math.abs(exported.duration - 2) <= 1.01 / exported.sampleRate,
      'Exported WAV duration exceeds one resampling frame',
    );
    log('PASS: aligned 48 kHz stems have exactly equal lengths; exported WAV decodes');
    await transport.start({ ...p, speed: 0.75 }, 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert(transport.position() > 0 && transport.playing, 'Playback clock did not advance');
    transport.pause();
    log('PASS: pitch-preserving transport starts and advances');
    output.setAttribute('data-result', 'passed');
    log('ALL BROWSER CHECKS PASSED');
  } catch (e) {
    output.setAttribute('data-result', 'failed');
    log('FAIL: ' + String(e));
  } finally {
    recorder?.close();
    transport.pause();
    for (const id of ids) await deleteProject(id);
    button.disabled = false;
  }
};
