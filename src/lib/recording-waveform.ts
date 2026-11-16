// Small PCM envelopes for an in-progress take, in selected-input channel order.
// startFrame and each entry in frames refer to captured PCM samples, excluding
// count-in. The final bin can be shorter than framesPerBin.
export type RecordingWaveformPacket = {
  sampleRate: number;
  startFrame: number;
  framesPerBin: number;
  frames: Uint32Array;
  min: Float32Array[];
  max: Float32Array[];
};
