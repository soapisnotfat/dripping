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

## Edge trims, lighter selection and clean output, 2026-11-15

- Selected audio regions expose left/right trim handles. Dragging previews the waveform and commits one undo entry on release; cancellation leaves the model unchanged. Source bounds, track offsets, clip rates and neighboring regions constrain the edit. Trims preserve source assets and retain a short 3 ms boundary fade to reduce clicks. The visible source can be restored by pulling the edge back.
- Browser checks trimmed a region from 16–24 to 18.125–24 seconds, restored it with one Undo, shortened its right edge to 21.875 and pulled it back to the neighbor boundary at 24. Keyboard fine adjustment moved the right edge to 23.99 seconds. At a 393 px mobile viewport, a 0–8 second region trimmed to 1.25–8 and returned with Undo. All three label/lane pairs stayed at 83 px and the document width stayed 393 px. These are Chromium pointer/mobile-emulation checks, not physical iOS tests.
- Whole-region selection now uses an 8% tint of the track color, thin boundaries and trim grips; it does not stack the range overlay over the entire region. A smaller inner range has its own light tint.
- Added separate recording-input and stereo main-output sample-peak meters, a held output peak and saved main-output gain. A steady recorded tone measured −30.4 dBFS at −6 dB output gain and −24.4 dBFS at 0 dB; pausing retained the −24.4 dBFS peak hold. The pre-record input check displayed an overload warning for a synthetic 1.05-peak signal. Worklet tests verify that brief overloads between meter updates are retained.
- Mix export defaults to 48 kHz / 24-bit PCM WAV, with a 32-bit float option; stems remain 48 kHz / 32-bit float. Mix analysis uses BS.1770 K-weighting, 400 ms / 75% overlap loudness gates and the Annex 2 four-phase true-peak filter. Optional target matching and peak protection use constant gain, with no compressor or limiter. The true-peak estimate has an additional 0.7 dB safety margin; it is not a certified hardware meter.
- Compared three generated fixtures with FFmpeg: a 997 Hz tone, stereo dynamic music with silent/quiet sections and opposite channel phase, and a 12 kHz intersample-peak stress signal. Integrated-loudness differences were at most 0.075 LU. True-peak differences ranged from 0.009 to 0.514 dB; the sharp stress signal under-read is why the extra guard is retained. Its naturally protected PCM24 export measured −1.18 dBTP against a selected −1 dBTP ceiling.
- Verified the actual browser-downloaded files: both contain 1,932,001 stereo frames at 48 kHz / 24-bit PCM. Natural export measured −27.72 LUFS / −16.07 dBTP. Matching −18 LUFS produced −18.05 LUFS / −6.41 dBTP. Loudness range remained 14.1 LU; 2,243 inspected sample pairs matched one constant gain with residual below 0.000000236.
- Native browser rate-changing paths attenuated the 18 kHz fixture. The final worker uses rational-phase, Blackman-windowed sinc conversion (128-tap base, wider for downsampling). 44.1 → 48 kHz retained amplitude 0.199996 from source 0.2 with exactly 48,000 frames. Unit tests also cover a 20 kHz stereo channel and rejection of a 28 kHz component when converting 96 → 48 kHz.
- 59 unit/component tests pass. The browser harness also passes scheduled dry capture (26,460 frames at 44.1 kHz), interruption recovery, byte-identical original-take backup/restore, equal-length stems and advancing transport. New behavior adds no runtime dependencies.

## Limits to keep visible

- Physical audio capture, channel routing, acoustic bleed, latency calibration, and iPad Safari capture/background behavior have not been verified on hardware. AE-20 device discovery was verified as described above.
- The written score tempo always sets the project clock. Automatic alignment estimates where score content occurs in raw audio and produces a candidate; it never replaces that clock. Sparse/repetitive accompaniment and a different arrangement may require manual source pairs or a matching demonstration.
- Reference audio retains its original timing. Conforming a track creates a new asset; original sources and takes remain in the project. Alignment and notation-pitch edits are undoable. A tempo-only change retimes the arrangement while preserving its musical source positions.
- IndexedDB is device/browser/origin specific. Export project backups independently of browser storage.

## Score-reference and original-source review

The alignment reference follows actual MusicXML parts placed on the selected part's canonical measure route, including pickups and repeats. Tests cover sounding transposition, voices, separate-part ties, notation-pitch undo/redo, unchanged reference identity after a tempo-only edit, and provenance/evidence backup round trips. Existing explicit MusicXML pitch declarations are retained. Ordinary files with no transpose use the standard zero-transposition default; an explicitly named transposing instrument missing its declaration requires review.

Automatic application now requires note/attack or shared-accompaniment evidence. Synthetic negatives cover melody-free backing, a repeated eight-note prefix, a constant shared bass note, unresolved adjacent source-note positions, and missing score tempo. These are rejection checks, not calibrated note-accuracy or onset-accuracy guarantees. A correct manually reviewed map can verify actual shared demo/backing content; an older DTW bridge may still be rejected until its source positions improve.

Isolated Chrome production checks cover a positive self-composed demonstration through conform and project backup, source identity preservation, original-waveform keyboard/touch-point navigation and audition, two-point manual pairing, notation-pitch persistence and undo, weak-candidate rejection, and 393/768px layouts. Source audio is auditioned directly; it is no longer labeled with bars calculated merely from the score tempo. Precise onset matching and difficult arrangement/version differences remain open work.

Reference-window regression: a self-composed source trimmed after three leading score beats previously placed its first note +1.388 score beats late. Cropping only the reference's leading/trailing unpitched frames, preserving the original q offset and internal rests, reduced the fixture maximum from 1.388 to 0.208 beats. Tests also cover a tempo change inside the omitted rest, explicit Alto transposition, all-rest rejection, and final conformed PCM silence/duration. This is a coarse matching regression bound, not the finer onset-quality target. A partially reviewed real full-song candidate remains ambiguous after this change.

## Distributed phrases and full-content refinement

- Distributed score phrases constrain pinned local matching; they do not stand in for checking all notes. The original complete example checks all 51 sounding attacks and remains automatically applicable. A 120-bar / 480-attack generated score checks every attack even when phrase selection reaches its 32-phrase cap. A score-onset term fixes false rejection of repeated same-pitch attacks; the older default DTW path is unchanged.
- Generated source-duration ratios .5, .8, 1, 1.137, 1.5 and 2 recover distributed phrases with fixture-specific source-onset errors below 1/16 local score beat. Pickup, 6/8 units, Alto transposition and written tempo changes are covered. These are source-position results, not final conformed PCM quality claims. Duplicate performances remain ambiguous; silence, noise and melody-free accompaniment do not produce a strong match.
- Local manual pairing preserves every exterior automatic anchor and its provenance. The first pair stays pending; two audible source pairs rebuild only their interval. Conflicts with exterior music are rejected without clamping or deleting exterior points. Mixed results retain their score signature and unverified ranges; manual authorization does not certify the whole score. Original sources, undo/redo and project-backup restore are covered.
- Actual Chrome production-worker validation processed a 900-second / 9,600-attack generated sixteenth-note input in 3.962 seconds on an earlier build and 6.6425 seconds on the final worker. Both runs analyzed all attacks and reported 67 progress messages; these desktop Chrome timings are observations, not a fixed runtime guarantee. The 39.69 MB owned analysis buffer was transferred. In the final-worker run, sampled RSS for the entire isolated Chrome instance rose from 767,424 to 917,808 KiB (150,384 KiB observed delta); this is not a worker-only heap or physical mobile measurement. Time-indexed searches replaced the earlier square-budget rejection.
- Actual page checks verify a booted Worker terminates on Cancel, a new Worker restarts successfully, stage progress appears, complete ordinary Flute/Piano imports remain applicable, local corrections survive backup/import and undo, partial candidates can be auditioned/stopped without commit, and 393/768px layouts fit. The private partially reviewed real score still has unsupported musical ranges, so automatic application stays blocked. Private media and diagnostic harnesses are excluded from the repository.

- An accepted manual demo with a current score signature, monotone map and at least two real pairs (or compatible legacy anchors) remains a legal backing reference. Its shared-content check runs separately and stores a manual source basis. Actual Chrome checks cover this positive flow and rejection of repeated/unrelated backing, unapplied/stale demo maps and one-pair maps.
- Reproduced a checked Score synth switch producing zero reference gain when recording directly after closing Alignment. Recording now reads current cue preferences after asynchronous input connection. Virtual-microphone checks verify synth/click startup, all four live toggle combinations, changes during delayed connection, and two saved takes; this is not physical capture validation.

## Browser PDF import integration (review branch)

- A clean dependency install and production build downloaded the three official homr model archives from an empty local model cache. Archive and raw ONNX checksums passed. Vendored SDK/archive/notices are separately checked; no model binaries or source scores enter Git history. Ordinary installation precaches 12 core files, excluding the recognition package. Actual MusicXML and MXL imports render and play without requesting recognition code or CDN runtime assets (9 checks).
- Actual production App checks under `/dripping/` passed 25 checks in Chrome JSPI and 25 in Chrome with JSPI hidden to exercise the actual shared-memory bridge. The latter performs exactly one initial bootstrap reload before file selection and none during conversion, retry, practice or recording. Both cover an invalid PDF retaining the previous project/files, cancellation after a recognition Worker has posted status, retry with PDF plus backing/demo, parsing/rendering all four 6/8 measures, practice, virtual-microphone recording with live cue changes, source downloads and backup restoration in a fresh context with byte-identical original PDF.
- The shared-memory test exposed a real host integration failure: page-only isolation headers left the OMR/network module workers unable to start. The host service worker now adds COOP/COEP to same-origin worker responses as well. The rerun completes using the shared-memory bridge. Only the host service worker is registered; observed HTTP requests are static GETs, with no score POST or inference endpoint.
- Real isolated Playwright WebKit 27.2 also passes 24 equivalent App checks through the shared-memory bridge, excluding the Chrome-only virtual microphone check. The ephemeral WebKit context could not store even a native Blob in IndexedDB; an isolated fresh persistent profile passed the Blob/ArrayBuffer control and was used for the App test. No application storage-format change was made to accommodate this test-mode restriction. These desktop engine checks are not physical Safari/iPad/iPhone capture or memory qualification.
- With the initial v11 pin, the generated fixture's printed quarter-note = 96 was not transcribed. The test records that failure; practice stays gated until the normal automatic tempo input is used. Printed-tempo recognition must be rerun in the full App after the reviewed source-metadata pin update. Four-measure/32-note fixture coverage does not establish a general transcription-accuracy percentage.
- All 162 unit/component tests pass with two workers. An earlier run using 25 simultaneous test workers while browser recognition was active timed out three existing DSP tests at five seconds; their assertions pass in the bounded-concurrency run and the draft CI checks pass. No test timeout was increased.
