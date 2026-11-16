import { expect, it } from 'vitest';
import { aerophoneModel, findAutomaticAudioPair } from '../src/lib/audio-devices';

const device = (
  deviceId: string,
  kind: MediaDeviceKind,
  label: string,
  groupId = '',
): MediaDeviceInfo => ({
  deviceId,
  kind,
  label,
  groupId,
  toJSON: () => ({ deviceId, kind, label, groupId }),
});

it.each(['AE-20', 'ae20', 'Roland AE 20', 'Input (AE–20)', 'Aerophone AE-20 USB Audio'])(
  'recognizes the audio label %s without requiring MIDI',
  (label) => expect(aerophoneModel(label)).toBe('AE-20'),
);

it('recognizes AE-30 while excluding other models and unrelated devices', () => {
  expect(aerophoneModel('Aerophone ae_30')).toBe('AE-30');
  for (const label of ['', 'AE-200', 'XAE20', 'AE-20x', 'USB Audio', 'Bluetooth Headphones'])
    expect(aerophoneModel(label)).toBeNull();
});

it('pairs by a shared physical group even when output labels differ', () => {
  const input = device('input', 'audioinput', 'AE-20', 'instrument'),
    output = device('output', 'audiooutput', 'Speakers', 'instrument');
  expect(
    findAutomaticAudioPair([device('mic', 'audioinput', 'Built-in microphone'), input, output]),
  ).toEqual({ input, output });
});

it('ignores default and communications aliases rather than treating them as extra hardware', () => {
  const input = device('input', 'audioinput', 'AE-20', 'instrument'),
    output = device('output', 'audiooutput', 'AE-20', 'instrument');
  expect(
    findAutomaticAudioPair([
      device('default', 'audioinput', 'Default - AE-20', 'instrument'),
      device('communications', 'audiooutput', 'Communications - AE-20', 'instrument'),
      input,
      output,
    ]),
  ).toEqual({ input, output });
});

it('falls back to one unambiguous model label when group ids are unavailable', () => {
  const input = device('input', 'audioinput', 'AE20'),
    output = device('output', 'audiooutput', 'Speakers (AE-20)');
  expect(
    findAutomaticAudioPair([input, output, device('laptop', 'audiooutput', 'Built-in speakers')]),
  ).toEqual({ input, output });
});

it('does not guess an output when matching labels have different known physical groups', () => {
  const input = device('input', 'audioinput', 'AE-20', 'one'),
    output = device('output', 'audiooutput', 'AE-20', 'two');
  expect(findAutomaticAudioPair([input, output])).toEqual({ input, output: undefined });
});

it('keeps a recognized input usable without an available or unambiguous output', () => {
  const input = device('input', 'audioinput', 'AE-20', 'instrument');
  expect(findAutomaticAudioPair([input])).toEqual({ input, output: undefined });
  expect(
    findAutomaticAudioPair([
      input,
      device('left', 'audiooutput', 'AE-20 Out 1', 'instrument'),
      device('right', 'audiooutput', 'AE-20 Out 2', 'instrument'),
    ]),
  ).toEqual({ input, output: undefined });
});

it('requires a remembered recognized input when multiple instruments are connected', () => {
  const input = device('ae20', 'audioinput', 'AE-20', 'one'),
    other = device('ae30', 'audioinput', 'AE-30', 'two'),
    output = device('output', 'audiooutput', 'AE-20', 'one');
  expect(findAutomaticAudioPair([input, other, output])).toBeNull();
  expect(findAutomaticAudioPair([input, other, output], 'ae20')).toEqual({ input, output });
});

it('does not pair a remembered instrument by label when another identical input is present', () => {
  const input = device('one', 'audioinput', 'AE-20'),
    other = device('two', 'audioinput', 'AE-20'),
    output = device('output', 'audiooutput', 'AE-20');
  expect(findAutomaticAudioPair([input, other, output], 'one')).toEqual({
    input,
    output: undefined,
  });
});

it('ignores an unrelated saved input while detecting a newly connected Aerophone', () => {
  const input = device('input', 'audioinput', 'AE-20');
  expect(
    findAutomaticAudioPair(
      [device('laptop', 'audioinput', 'Built-in microphone'), input],
      'laptop',
    ),
  ).toEqual({ input, output: undefined });
});

it('does not select unidentified, disconnected, or explicit Bluetooth devices', () => {
  expect(findAutomaticAudioPair([device('', 'audioinput', '')])).toBeNull();
  expect(findAutomaticAudioPair([], 'disconnected')).toBeNull();
  expect(findAutomaticAudioPair([device('wireless', 'audioinput', 'AE-20 Bluetooth')])).toBeNull();
  const input = device('usb', 'audioinput', 'AE-20');
  expect(
    findAutomaticAudioPair([input, device('wireless', 'audiooutput', 'AE-20 Bluetooth')]),
  ).toEqual({ input, output: undefined });
});
