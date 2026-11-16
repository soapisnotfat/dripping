export type AerophoneModel = 'AE-20' | 'AE-30';
export type AudioDevicePair = { input: MediaDeviceInfo; output?: MediaDeviceInfo };

// Device labels are exposed only after the browser has granted audio access.
export function aerophoneModel(label: string): AerophoneModel | null {
  const match = label.match(/(?:^|[^a-z0-9])ae[\s_\-\u2010-\u2015]*([23]0)(?=$|[^a-z0-9])/i);
  return match ? (`AE-${match[1]}` as AerophoneModel) : null;
}

function physicalDevices(devices: MediaDeviceInfo[], kind: MediaDeviceKind) {
  const ids = new Set<string>();
  return devices.filter((device) => {
    if (
      device.kind !== kind ||
      !device.deviceId ||
      device.deviceId === 'default' ||
      device.deviceId === 'communications' ||
      /bluetooth|hands[- ]free|a2dp/i.test(device.label) ||
      ids.has(device.deviceId)
    )
      return false;
    ids.add(device.deviceId);
    return true;
  });
}

// Match only known instruments. A laptop microphone or an unrelated newly
// connected headset must never become the automatic recording target.
export function findAutomaticAudioPair(
  devices: MediaDeviceInfo[],
  preferredInputId?: string,
): AudioDevicePair | null {
  const inputs = physicalDevices(devices, 'audioinput').filter((device) =>
      aerophoneModel(device.label),
    ),
    preferred = inputs.find((device) => device.deviceId === preferredInputId),
    input = preferred ?? (inputs.length === 1 ? inputs[0] : undefined);
  if (!input) return null;

  const outputs = physicalDevices(devices, 'audiooutput'),
    grouped = input.groupId ? outputs.filter((device) => device.groupId === input.groupId) : [];
  if (grouped.length) return { input, output: grouped.length === 1 ? grouped[0] : undefined };

  const model = aerophoneModel(input.label),
    matchingInputs = inputs.filter((device) => aerophoneModel(device.label) === model),
    matchingOutputs = outputs.filter(
      (device) =>
        aerophoneModel(device.label) === model &&
        // A differing known group is positive evidence of a different device.
        (!input.groupId || !device.groupId),
    );
  return {
    input,
    output:
      matchingInputs.length === 1 && matchingOutputs.length === 1 ? matchingOutputs[0] : undefined,
  };
}
