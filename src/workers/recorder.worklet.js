class DrippingPCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.channels || [0];
    this.capacity = 4096;
    this.offset = 0;
    this.sequence = 0;
    this.active = false;
    this.finished = false;
    this.buffers = this.channels.map(() => new Float32Array(this.capacity));
    this.meterPeaks = this.channels.map(() => 0);
    this.meterClipped = false;
    this.framesPerBin = Math.max(1, Math.round(sampleRate / 100));
    this.waveformBatchBins = Math.max(
      1,
      Math.min(4, Math.floor((this.capacity - 1) / this.framesPerBin)),
    );
    this.resetWaveform();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'arm') {
        this.startFrame = data.startFrame;
        this.endFrame = data.endFrame;
        this.resetWaveform();
        this.active = true;
      }
      if (data.type === 'stop') {
        this.endFrame = Math.min(this.endFrame ?? Infinity, currentFrame);
        this.finish();
      }
    };
  }
  resetWaveform() {
    this.waveformStart = 0;
    this.waveformFrames = [];
    this.waveformMin = this.channels.map(() => []);
    this.waveformMax = this.channels.map(() => []);
    this.binFrames = 0;
    this.binMin = this.channels.map(() => Infinity);
    this.binMax = this.channels.map(() => -Infinity);
  }
  finishWaveformBin() {
    if (!this.binFrames) return;
    this.waveformFrames.push(this.binFrames);
    for (let c = 0; c < this.channels.length; c++) {
      this.waveformMin[c].push(this.binMin[c]);
      this.waveformMax[c].push(this.binMax[c]);
      this.binMin[c] = Infinity;
      this.binMax[c] = -Infinity;
    }
    this.binFrames = 0;
    // Normally send four 10 ms bins; use smaller batches at high sample rates
    // so the preview need not wait for the independent persistent PCM chunk.
    if (this.waveformFrames.length >= this.waveformBatchBins) this.flushWaveform();
  }
  flushWaveform() {
    if (!this.waveformFrames.length) return;
    const frames = new Uint32Array(this.waveformFrames),
      min = this.waveformMin.map((values) => new Float32Array(values)),
      max = this.waveformMax.map((values) => new Float32Array(values));
    this.port.postMessage(
      {
        type: 'waveform',
        sampleRate,
        startFrame: this.waveformStart,
        framesPerBin: this.framesPerBin,
        frames,
        min,
        max,
      },
      [frames.buffer, ...min.map((values) => values.buffer), ...max.map((values) => values.buffer)],
    );
    this.waveformStart += this.waveformFrames.reduce((sum, value) => sum + value, 0);
    this.waveformFrames.length = 0;
    for (const values of [...this.waveformMin, ...this.waveformMax]) values.length = 0;
  }
  flush() {
    if (!this.offset) return;
    const data = this.buffers.map((b) => b.slice(0, this.offset));
    this.port.postMessage(
      { type: 'chunk', sequence: this.sequence++, data },
      data.map((c) => c.buffer),
    );
    this.offset = 0;
  }
  finish() {
    if (this.finished) return;
    this.finishWaveformBin();
    this.flushWaveform();
    this.flush();
    this.active = false;
    this.finished = true;
    this.port.postMessage({ type: 'done' });
  }
  process(inputs, outputs) {
    // Outputs deliberately remain zero: input is never mixed with the backing bus.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.finished) return true;
    const input = inputs[0];
    if (!input?.length) return true;
    if (this.channels.some((c) => c >= input.length)) {
      this.port.postMessage({
        type: 'error',
        message: '所选输入通道不可用 / Selected input channel unavailable',
      });
      this.finish();
      return true;
    }
    const peaks = this.channels.map((channel) => {
      let peak = 0;
      for (const value of input[channel]) peak = Math.max(peak, Math.abs(value));
      return peak;
    });
    peaks.forEach((peak, index) => {
      this.meterPeaks[index] = Math.max(this.meterPeaks[index], peak);
      if (peak >= 0.999) this.meterClipped = true;
    });
    if (currentFrame % (128 * 12) === 0) {
      this.port.postMessage({
        type: 'meter',
        peak: Math.max(...this.meterPeaks),
        peaks: this.meterPeaks.slice(),
        clipped: this.meterClipped,
      });
      this.meterPeaks.fill(0);
      this.meterClipped = false;
    }
    if (!this.active) return true;
    for (let i = 0; i < input[0].length; i++) {
      const frame = currentFrame + i;
      if (frame >= this.endFrame) {
        this.finish();
        break;
      }
      if (frame < this.startFrame) continue;
      for (let c = 0; c < this.channels.length; c++) {
        const value = input[this.channels[c]][i];
        this.buffers[c][this.offset] = value;
        this.binMin[c] = Math.min(this.binMin[c], value);
        this.binMax[c] = Math.max(this.binMax[c], value);
      }
      if (++this.binFrames === this.framesPerBin) this.finishWaveformBin();
      if (++this.offset === this.capacity) this.flush();
    }
    return true;
  }
}
registerProcessor('dripping-pcm-recorder', DrippingPCMRecorder);
