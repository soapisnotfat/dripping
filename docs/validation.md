# Dripping 0.1.0 validation

Validated locally on 2026-11-14. This is a first usable release, not a claim of universal score or hardware compatibility.

## Automated checks

- 22 unit tests pass across MusicXML interpretation, tempo mapping, alignment, audio rendering, storage, and audio-input connection cleanup.
- MusicXML fixtures cover meter changes, pickup duration, multi-measure rests, ties, grace notes, tuplets, polyphonic backup, first/second endings, transposition, MXL input, and rejection of XML entities.
- Audio tests cover original PCM preservation, clip boundaries, resampling, fades, pitch-preserving stretching, and WAV headers.
- Alignment uses score/audio content. Synthetic melody and backing tracks have different leading silence; test expectations are independent of the matching result. Silent audio is not marked accepted.
- Recording latency compensation at project zero preserves the entire original take while trimming only its playable clip. Repeating finalization does not duplicate assets or takes.
- TypeScript checking and the production Vite build pass.

## Real browser checks

The developer test page uses browser AudioContext, a real AudioWorklet, a generated MediaStream, workers, and IndexedDB. It requests no physical microphone access.

- Imported the generated MusicXML and two WAV tracks through the normal import function.
- Measured a 40 ms median error at inspected points on the generated demonstration, whose known leading offset is 550 ms. This describes this fixture only.
- Captured 26,460 PCM frames at 44.1 kHz over a scheduled 600 ms interval; stored a take recorded at 75% practice speed with its original data intact.
- Recovered an interrupted session from its committed recording chunks.
- Exported and restored edited tracks, undo history, and original takes; compared the original take bytes exactly.
- Rendered equal-length 48 kHz stems. Browser decoding to its 44.1 kHz AudioContext differs by one resampling frame; the WAV files themselves have identical frame counts.
- Started the pitch-preserving transport and verified that its playback clock advances.

The exported dry take contains the injected 440 Hz tone at amplitude 0.1; checked 110/220/330/660 Hz components were below 0.0001 while the backing was playing.

The complete UI was also exercised: example import, alignment analysis and reference acceptance, play/pause, record/stop, note-range clear, undo, project backup download, WAV-stem ZIP download, and restoration through the file picker. The exported three-track session contains three 48 kHz/32-bit float WAVs with 1,932,001 frames each. The slightly non-integer duration comes from browser input decoding; all stems share it exactly.

The production build was loaded over localhost, controlled by its service worker, reloaded with networking disabled, and played its saved project offline. Networking was restored after the check. Production console errors: none observed. At 768 × 1024, the score reflows within its viewport and the document has no horizontal overflow; the timeline scrolls separately.

## AE-20 device discovery

macOS identified the Roland AE-20 as a USB audio device with two input and two output channels, at 44.1 kHz. Chrome's microphone permission selector and Dripping's audio-input selector both listed AE-20. MIDI was not used. Opening this device through the new connection test, capturing an actual performance, and measuring latency remain unverified; the browser connection ended before that test completed.

## Limits to keep visible

- Physical audio capture, channel routing, acoustic bleed, latency calibration, and iPad Safari capture/background behavior have not been verified on hardware. AE-20 device discovery was verified as described above.
- A score-only tempo map is an estimate until aligned to a recording. Automatic alignment always produces a candidate. Sparse/repetitive accompaniment and a different arrangement may require manual anchors or a matching demonstration.
- The reference audio must retain its original timing. Conforming another track creates a new asset; original sources and takes remain in the project. Reference changes are undoable but do not implicitly reconform other tracks.
- IndexedDB is device/browser/origin specific. Export project backups independently of browser storage.
