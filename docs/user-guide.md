# Practice and recording guide

[Back to the project](../README.md) · [Development](development.md)

Open [Dripping](https://soapisnotfat.github.io/dripping/) and choose **Try an example** for the included *Morning Drops* exercise, or **New practice** for your own score and audio. The example is composed for this application and uses generated audio; it does not require external music files.

Recording requires microphone permission and an HTTPS or localhost address. Use headphones when recording alongside a backing track.

## Import your music

Add a `.pdf`, `.musicxml`, `.xml`, or `.mxl` score, with optional audio files. Assign each file its role: Score, Backing, or Demo recording. Practice and recording require a score; existing audio-only projects retain their data until a score is added. PDF and audio are saved first and open in the workspace.

The original PDF is visible while recognition runs in the background; you can rename, mix and add audio. Pausing or failure keeps the PDF project available for Retry and backup. Practice waits for the recognized score and tempo. Original PDFs, generated MusicXML and conversion provenance are included in project backups.

## Set the score tempo

The score's tempo, meter and expanded repeat route set the clock for every project. Enter **Score tempo BPM** to change the opening tempo; valid input applies automatically and can be undone. If the opening tempo is missing, entering a valid BPM enables practice. Later written tempo changes remain in place.

## Align audio to the score

Open **Alignment**, analyze the demonstration track, and audition the candidate with score synth.

MusicXML transposition is respected, including its normal zero-transposition default when omitted. An explicitly named transposing instrument with no declaration asks for notation review; you can also correct the notation interpretation when the source score shows a different instrument. Note evidence is shown as musical positions linked to the original waveform. Weak or ambiguous candidates cannot be applied automatically.

To correct a local passage, audition the original waveform and pair two real source points with score bars and beats; only their interval is rebuilt, and exterior automatic timing stays intact. **Pair manually** starts a separate whole-track manual map. Then choose **Align track to score**. Unverified ranges stay visible on a mixed manual result.

A reviewed demonstration can help match the backing when shared accompaniment is detected. Conformation adjusts audio to the score's musical clock, including written tempo changes, meter and manual offbeat anchors. Original audio is retained and the edit is undoable. Automatic candidates still require content and listening checks.

## Practice and edit a passage

Click a note, the ruler, or an audio waveform to move the playback cursor and clear the previous range. Waveform and ruler clicks follow **Snap**; turn Snap off or hold Alt to choose any exact point. Double-click an audio region to select the whole region, drag across notes or within a region to select a range, or enter start/end bars and beats above the tracks and choose **Create range**. The range editor shows the track that clip edits will affect. Enable **Loop selection** separately; selecting an edit track does not arm it for recording.

Drag the selected region's left/right handles to trim it without changing the source. Snap applies to edge drags; hold Alt to bypass it. Arrow keys adjust a focused handle by one beat, or one eighth of a beat with Shift. Use **Edit selection** for splitting, fades, or punch-in recording.

To remove a whole region, double-click it and choose **Delete region** above the tracks, or press **Delete** / **Backspace**. For a partial range, the button reads **Delete selected audio**. Deleting a range removes only that audio from the selected track and leaves the other regions in place. Undo restores it; the original source recording remains available.

## Record a take

Choose **+ Recording track** to create and arm a track, or use an existing recording track’s **R** button to make it the recording target. The target appears below the playback time; only one track can be armed.

In **Audio devices**, choose your input, output, and channels. With **Automatically select input and output** enabled, connecting an AE-20 or AE-30 selects its audio input and matching output. Allow audio access once so the browser can expose device names. This uses USB audio, not MIDI. If there are multiple possible matches, select the devices manually; a manual selection turns automatic switching off until you enable it again.

Output switching requires a browser with `AudioContext.setSinkId`. Otherwise select your instrument as the system sound output. The panel shows the applied output, and reports denied or unsupported switches. Device changes wait until recording and input-level checks finish. If an input disconnects, reconnect or select another input before recording; the app does not silently use the computer microphone.

**Test connection** reports device settings; **Check input levels** displays the selected channels while you play, without saving a take or monitoring input. Set the count-in and timing correction before recording. Corrections are saved separately for each input/output/channel combination and restored on reconnect. A positive value shifts new recordings earlier; it does not change existing takes or remove live monitoring delay. Automatic device selection is not automatic latency calibration: the page does not have complete input hardware timestamps. See [audio routing and timing](audio-devices.md).

Dripping captures the selected input separately from playback and preserves the original take when you edit or replace a passage. After an interrupted recording, it can recover audio chunks that were saved before the interruption.

While recording, the target track shows a growing waveform of the captured input and a live input-level meter in dBFS. Silence appears as a flat line; loud peaks appear taller. Stereo input has separate waveforms for its two channels. A red warning is retained when the input approaches clipping. Count-in does not add audio to the waveform. The preview follows the same practice-speed and timing-correction placement as the saved take.

During recording, use each track's **M** (Mute), **S** (Solo), and volume fader to change what you hear immediately. These controls do not change the dry input being recorded. The recording target stays silent during capture; changing the target or editing audio waits until recording stops.

## Save and restore a project

Projects save automatically in the current browser. Each browser and site address has its own project library, so a project saved on localhost will not appear automatically on a deployed site or another device.

The footer shows **Saved in this browser** only after the latest revision is persisted. If saving fails, **Retry save** retries the latest draft and its pending assets; a project backup remains available.

Export a **Project backup** regularly. Browser storage can be cleared or evicted. To move a project, open its `.drippingproj` file through **New practice** on the destination browser. Import creates a separate project and checks the included assets for integrity.

## Export audio

Open **Export** to download stems, a mix, original takes, or a project backup.

| Export | Contents |
| --- | --- |
| WAV stems | One 48 kHz, 32-bit float WAV per selected track, with a shared start and length. Clip edits and fades are included; track volume and pan are excluded. |
| Mix WAV | 48 kHz / 24-bit PCM by default, with optional 32-bit float. Includes faders, pan and main output gain, with constant-gain peak protection. Optional integrated-loudness matching preserves dynamics. |
| Original dry takes | Unedited input recordings at their original capture sample rate and practice speed. |
| Project backup | A `.drippingproj` file containing source assets, recordings, edits, and undo history. |

Export initially selects tracks that are audible under the current mute/solo settings. You can change each checkbox, including adding a muted track, or choose **Select currently audible tracks** to reset the selection. Score synth and metronome are excluded from audio exports.

Stems and mixes default to the project's original tempo; **Export speed** also offers the current practice speed. A take recorded at 75% is fitted to the original tempo in the arrangement, while its original dry take download always retains the captured recording.

### Levels and mix analysis

The input and main-output meters show sample peaks in dBFS; the output peak hold remains visible after pausing. Input peaks near full scale are latched so brief overloads are not missed. Adjust input gain on your audio device; the main output gain changes playback and mixes, not the dry capture.

**Analyze mix** reports estimated true peak (dBTP), integrated loudness (LUFS-I) and the planned final gain. Loudness matching is off by default. When enabled, the selected target replaces main output gain; peak headroom takes priority if both targets cannot be met. Peak protection applies one gain to the whole mix and adds 0.7 dB of safety margin for the four-times true-peak estimate. Stems and original dry takes retain their separate export rules.

### Sample rates and source takes

Export sample-rate conversion uses a band-limited resampler in the audio worker. Raw captures retain the AudioContext capture rate and float32 samples. Writing a higher-resolution output does not restore information lost at the microphone or audio interface.

## Compatibility and limits

Dripping is in early development. Desktop browser workflows have been tested with generated audio; physical audio capture, latency calibration, and iPad Safari recording still need device testing. AE-20 device discovery has been verified. See the [validation record](validation.md) for test coverage and results.

### Alignment review

The score follows its written tempo. Direct matching uses the selected score part's sounding pitch classes and attack evidence. For backing, available accompaniment parts follow the selected score's expanded repeat route; a reviewed demonstration can bridge through shared accompaniment content. A melody-only score may not supply enough evidence for accompaniment with no melody.

Original audio is reviewed on its actual waveform, paired with musical score positions. Conflicting instrument metadata, weak phrase entries, repeated phrases, sparse passages, and different arrangements require review. Reference identity follows note content and route, so a written-tempo-only change does not discard source positions.

Distributed phrase positions constrain full-content refinement; every pitched attack is checked, including notes outside the selected phrases. Analyzed-but-unsupported notes and unfinished analysis have separate musical ranges. Evidence thresholds are checks, not a calibrated accuracy score.

Conformation preserves musical boundaries, but pitch-preserving stretching can shift transients inside a segment. Fine onset timing still needs listening review.

### Input limits

| Input | Limit |
| --- | --- |
| Individual file | 160 MB |
| Audio track | 15 minutes |
| Project backup | 512 MB |

Large sessions can reach device memory limits before these limits. Alignment may request a shorter input when its comparison limit is reached.

### Score synth

The flute and piano options are synthesized cues for checking notes and timing. Choose the instrument before playback. **Score synth** and **Click** can be toggled independently during playback and recording. Choosing an instrument does not change imported recordings.

### Mobile use

The layout supports touch and tablet screens. On iPad, a deployed HTTPS site can be added to the Home Screen. Desktop viewport emulation does not establish physical iOS behavior.
