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

## Workbench control changes, 2026-11-15

- 40 unit/component tests and the production build pass. New checks cover export mute/solo defaults and manual overrides, exact range creation/editing and project changes, variable-meter position labels, stereo pan crossfeed, and selected-channel metering before recording.
- Re-ran `/tests/browser.html`: worker alignment, scheduled dry capture, interruption recovery, byte-identical backup/restore, equal-length stems and transport playback pass.
- The synthetic-input UI displays approximately −20.0 dBFS for an injected 0.1-peak signal before recording. Closing the input dialog stops the check. Physical-device metering remains unverified.
- Created the exact 5.125–12.750 second range without a drag gesture. Changing its edit track left looping off and the recording target unarmed.
- Export initially excludes a muted demonstration track; manually checking it adds it without unmuting playback. Resetting to audible tracks removes it again. Changing the score-synth instrument leaves the synth switch off.
- Downloaded the selected-range mix at 75% practice speed. Its WAV header contains two channels, 48 kHz, 16-bit PCM and 488,000 frames: exactly `(12.750 - 5.125) / 0.75` seconds.
- After dynamically narrowing to 768 × 1024, the score viewport and its scroll width both measured 734 px; the rendered SVG measured 698 px. Document width remained 768 px. This is desktop viewport emulation, not a physical iPad test.
- Imported a separately generated browser MusicXML into a new project: all 106 measures render. The application reports its incomplete measure and missing initial tempo instead of treating the score as fully verified. PDF conversion remains separate from the app.
- The real-accompaniment slow-playback quality report in Issue #3 remains open; these checks do not establish that its listening-quality problem is fixed.

## Timeline grid and mobile rows, 2026-11-15

- Removed the fixed 84 px background divisions. At the example's 96 BPM in 4/4 and 42 px/s, bars are 105 px apart. The ruler and every lane now use the same score-to-seconds positions, including alignment offsets, tempo changes and meter changes. Audio-only projects use the ruler's five-second positions.
- Reproduced the row-height failure with mobile text enlargement: label columns grew to 93.59375 px while the old lanes stayed at 83 px. Lanes now stretch with their row, and clips stay vertically centered.
- `/tests/timeline-layout.html` renders the real Timeline with three tracks, a muted Demo, an empty recording lane, a 4/4 → 2/4 score and a nonlinear timing map. All 24 combinations of score/audio-only timing, 12/42/84 px/s zoom and 100/125/150/200% text size passed in a 393 px mobile viewport. Numbered ruler lines and grid lines had 0 px measured horizontal deviation; label/lane top and bottom bounds matched.
- The geometry checks also passed after a 393 px horizontal scroll. The complete example workbench was inspected at 440 px: its first three ruler/grid positions were 201, 306 and 411 px in all three tracks.
- The 40 existing tests and production build pass. Browser checks used Chromium mobile emulation; physical iPhone Safari remains unverified.

## Audio regions and recording cues, 2026-11-15

- Audio-region selection follows GarageBand's tap-to-select-region convention ([Apple guide](https://support.apple.com/guide/garageband-ipad/edit-regions-chsec12c15d/ipados)). Dripping keeps drag gestures for selecting a range inside that region. Clicking an uncut example backing selected its full 0–40.250 second span. After two split operations produced five regions, each region could be selected independently. A drag from 1.875 seconds into the next region stopped at the original region's 8 second boundary.
- Region-scoped split, clear, trim and fades preserve other regions in the track. Tests cover offsets, snapping at region edges, reverse drags, keyboard selection, typed bounds and restoring whole-region selection. Split/trim update the selected region identity; clearing an interior range or overwriting the selected region clears the obsolete selection.
- Waveforms fill the row vertically. Region backgrounds and selected-region shading distinguish the active region without an inset card or vertical gap. Track labels and lanes retain their shared row heights and score-based grid.
- Removed the standalone instrument-preview control. Score synth and Click remain independently available during recording. On a second recording into a track with an existing take, the actual Web Audio gain for that track stayed at zero while reference/click gains changed to 0.65/0.6 and back to zero. The backing stayed at 0.8 and the recording clock continued.
- Two synthetic 440 Hz input takes contained 392,190 and 269,565 frames at 44.1 kHz (8.893 and 6.113 seconds). All 72 inspected interior 200 ms windows retained RMS 0.07071066; no silent gaps appeared while toggling cues. Residual RMS after fitting the 440 Hz tone stayed below 0.000000374. This verifies the synthetic input path; physical capture and acoustic bleed remain outside this check.
- 50 unit/component tests and the production build pass. Browser verification used Chromium, not physical iPad/iPhone hardware.

## Limits to keep visible

- Physical audio capture, channel routing, acoustic bleed, latency calibration, and iPad Safari capture/background behavior have not been verified on hardware. AE-20 device discovery was verified as described above.
- A score-only tempo map is an estimate until aligned to a recording. Automatic alignment always produces a candidate. Sparse/repetitive accompaniment and a different arrangement may require manual anchors or a matching demonstration.
- The reference audio must retain its original timing. Conforming another track creates a new asset; original sources and takes remain in the project. Reference changes are undoable but do not implicitly reconform other tracks.
- IndexedDB is device/browser/origin specific. Export project backups independently of browser storage.
