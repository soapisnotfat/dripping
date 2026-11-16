# Audio devices and recording alignment

Dripping pairs audio endpoints, not MIDI ports. After microphone permission exposes device labels, automatic mode recognizes AE-20 and AE-30 inputs and chooses a unique output in the same device group. When group identity is unavailable, it uses a unique matching model label. It does not guess between multiple instruments or outputs. Known Bluetooth endpoints and default/communications aliases are excluded from automatic physical-device matching.

The app enumerates devices on entry and on `devicechange`, including when an instrument was connected before the page opened. It requests microphone access only from the explicit authorization button and closes that temporary stream immediately. Recording and input-level checks retain their current devices; pending changes are processed afterwards. Manual input/output choices disable automatic mode and are remembered. An unavailable explicit input remains selected and unavailable instead of silently becoming the laptop microphone.

Output changes use `AudioContext.setSinkId` on the existing recording/playback context. They do not rebuild the audio graph. The panel shows the applied route after the switch succeeds; rejection does not claim a successful route change. Unsupported browsers retain system-default output and explain how to change it in system settings. Some browsers also offer an explicit output authorization picker.

## Timing and compensation

Input/output selection and latency correction are separate. Saving a correction associates it with the input, applied output, and selected channels. The system-default endpoint's exposed group/label is included when available, so changing the underlying default endpoint does not silently reuse a different route's correction. Old global corrections are migrated once to the initial route. New routes start at zero until a correction is saved for them.

Corrections affect new recordings through the existing session timing and clip placement. They preserve original dry takes. They neither move existing clips nor eliminate the delay of hearing input through the browser. Driver buffer changes, sample-rate changes and instrument attack behavior can also affect timing; a saved correction is not a fresh hardware measurement.

The page does not estimate hardware latency by asking a player to follow clicks, nor does it silently sum browser latency values and label the result calibrated. `MediaTrackSettings.latency` is a target value whose actual latency can vary. `AudioContext.outputLatency` is an output-latency estimate, and `getOutputTimestamp()` describes the output side. These do not supply a complete input hardware sample timestamp. A native audio engine can access Core Audio timing APIs, but adding one would require a separately designed and installed local component. Apple's public GarageBand guide does not specify its complete recording-compensation algorithm.

## Validation and references

Automated tests cover matching, hot-plug events, permissions, manual overrides, deferred switching, failed switches, route-specific correction persistence, and output routing on the existing context. These checks use synthetic endpoints; an attached AE-20 and its driver still need physical verification.

- [Chrome: changing the destination output device in Web Audio](https://developer.chrome.com/blog/audiocontext-setsinkid)
- [MDN: input latency settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/latency)
- [MDN: output latency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- [MDN: output timestamps](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
- [Apple: device input using the HAL Output Audio Unit](https://developer.apple.com/library/archive/technotes/tn2091/_index.html)
- [Apple: GarageBand input/output settings](https://support.apple.com/guide/garageband/change-audiomidi-settings-gbnd967819b9/mac)
