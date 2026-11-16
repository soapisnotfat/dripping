export function inputConstraints(deviceId: string, channels: number[]): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // Preserve a stereo interface before selecting a channel in the worklet.
      channelCount: { ideal: Math.max(2, ...channels.map((c) => c + 1)) },
    },
    video: false,
  };
}
export async function probeInput(deviceId: string, channels: number[]) {
  const stream = await navigator.mediaDevices.getUserMedia(inputConstraints(deviceId, channels));
  try {
    const track = stream.getAudioTracks()[0],
      settings = track.getSettings();
    if (settings.channelCount && Math.max(...channels) >= settings.channelCount)
      throw Error('所选输入通道不可用 / Selected input channel unavailable');
    return { name: track.label, sampleRate: settings.sampleRate, channels: settings.channelCount };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
