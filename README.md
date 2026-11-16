# Dripping

Dripping is a browser app for practicing and recording music with sheet music and backing tracks. Import a PDF or MusicXML score, follow it during playback, loop a difficult passage, and record your instrument on a separate track. Export your takes to continue editing in Logic Pro or GarageBand.

Audio, scores, and projects stay in your browser. No account or backend is required. The interface supports English and Chinese.

[Open Dripping](https://soapisnotfat.github.io/dripping/) · [Report a bug](https://github.com/soapisnotfat/dripping/issues)

## Features

- Interactive sheet music with note selection and playback tracking.
- Passage looping and practice speeds from 50% to 150%, with pitch preserved.
- Score-to-audio alignment with editable timing anchors.
- Mono or stereo recording from a selected audio input, with count-in and optional monitoring.
- Non-destructive clip editing, fades, track volume and pan, and undo/redo.
- Click an audio region to select it, drag inside for a smaller range, or drag its left/right handles to trim. Trims can be pulled back to the available source and undone; neighboring regions stay in place.
- WAV stem and mix exports, original take downloads, and portable project backups.
- Offline use after the production app has loaded and cached successfully.

## Quick start

Install **Node.js 22.12 or later**, then run:

```sh
git clone https://github.com/soapisnotfat/dripping.git
cd dripping
npm ci
npm run dev
```

Open the address printed in the terminal, usually `http://127.0.0.1:5173`. Choose **Try an example** to explore the app with an included exercise, or **New practice** to import your own files.

Recording requires microphone permission and an HTTPS or localhost address. Use headphones when recording alongside a backing track.

## Your first session

1. **Import your music.** Add a `.pdf`, `.musicxml`, `.xml`, or `.mxl` score, with optional audio files. Assign each file its role: Score, Backing, or Demo recording. Practice and recording require a score; existing audio-only projects retain their data until a score is added. PDF pages are converted to MusicXML in browser workers; models download on first use. Review the recognized notation. Cancellation or failure retains selected files and leaves the previous project intact. Original PDFs, generated MusicXML and conversion provenance are included in project backups.
2. **Check the written tempo.** The score's tempo, meter and expanded repeat route set the clock for every project. Enter **Score tempo BPM** to change the opening tempo; valid input applies automatically and can be undone. If the opening tempo is missing, entering a valid BPM enables practice. Later written tempo changes remain in place.
3. **Align audio to the score.** Open **Alignment**, analyze the demonstration track, and audition the candidate with score synth. MusicXML transposition is respected, including its normal zero-transposition default when omitted. An explicitly named transposing instrument with no declaration asks for notation review; you can also correct the notation interpretation when the source score shows a different instrument. Note evidence is shown as musical positions linked to the original waveform. Weak or ambiguous candidates cannot be applied automatically. To correct a local passage, audition the original waveform and pair two real source points with score bars and beats; only their interval is rebuilt, and exterior automatic timing stays intact. **Pair manually** starts a separate whole-track manual map. Then choose **Align track to score**. Unverified ranges stay visible on a mixed manual result. A reviewed demonstration can help match the backing when shared accompaniment is detected. Conformation adjusts audio to the score's musical clock, including written tempo changes, meter and manual offbeat anchors. Original audio is retained and the edit is undoable. Automatic candidates still require content and listening checks.
4. **Practice a passage.** Click a note to seek, drag across notes or a region, or enter start/end bars and beats above the tracks and choose **Create range**. The range editor shows the track that clip edits will affect. Enable **Loop selection** separately; selecting an edit track does not arm it for recording. Drag the selected region's left/right handles to trim it without changing the source. Snap applies to edge drags; hold Alt to bypass it. Arrow keys adjust a focused handle by one beat, or one eighth of a beat with Shift. Use **Edit selection** for splitting, fades, or punch-in recording.
5. **Record a take.** Choose **+ Recording track** to create and arm a track, or use an existing recording track’s **R** button to make it the recording target. The target appears below the playback time; only one track can be armed. In **Audio input**, choose your device and channels. **Test connection** reports device settings; **Check input levels** displays the selected channels while you play, without saving a take or monitoring input. Set the count-in and timing correction before recording. Dripping captures the selected input separately from playback and preserves the original take when you edit or replace a passage.
6. **Export your work.** Open **Export** to download stems, a mix, original takes, or a project backup.

## Saving and exporting

Projects save automatically in the current browser. Each browser and site address has its own project library, so a project saved on localhost will not appear automatically on a deployed site or another device.

The footer shows **Saved in this browser** only after the latest revision is persisted. If saving fails, **Retry save** retries the latest draft and its pending assets; a project backup remains available.

Export a **Project backup** regularly. Browser storage can be cleared or evicted. To move a project, open its `.drippingproj` file through **New practice** on the destination browser. Import creates a separate project and checks the included assets for integrity.

| Export | Contents |
| --- | --- |
| WAV stems | One 48 kHz, 32-bit float WAV per selected track, with a shared start and length. Clip edits and fades are included; track volume and pan are excluded. |
| Mix WAV | 48 kHz / 24-bit PCM by default, with optional 32-bit float. Includes faders, pan and main output gain, with constant-gain peak protection. Optional integrated-loudness matching preserves dynamics. |
| Original dry takes | Unedited input recordings at their original capture sample rate and practice speed. |
| Project backup | A `.drippingproj` file containing source assets, recordings, edits, and undo history. |

Export initially selects tracks that are audible under the current mute/solo settings. You can change each checkbox, including adding a muted track, or choose **Select currently audible tracks** to reset the selection. Score synth and metronome are excluded from audio exports.

Stems and mixes default to the project's original tempo; **Export speed** also offers the current practice speed. A take recorded at 75% is fitted to the original tempo in the arrangement, while its original dry take download always retains the captured recording.

The input and main-output meters show sample peaks in dBFS; the output peak hold remains visible after pausing. Input peaks near full scale are latched so brief overloads are not missed. Adjust input gain on your audio device; the main output gain changes playback and mixes, not the dry capture.

**Analyze mix** reports estimated true peak (dBTP), integrated loudness (LUFS-I) and the planned final gain. Loudness matching is off by default. When enabled, the selected target replaces main output gain; peak headroom takes priority if both targets cannot be met. Peak protection applies one gain to the whole mix and adds 0.7 dB of safety margin for the four-times true-peak estimate. Stems and original dry takes retain their separate export rules.

Export sample-rate conversion uses a band-limited resampler in the audio worker. Raw captures retain the AudioContext capture rate and float32 samples. Writing a higher-resolution output does not restore information lost at the microphone or audio interface.

After an interrupted recording, Dripping can recover audio chunks that were saved before the interruption.

## Compatibility and limits

Dripping is in early development. Desktop browser workflows have been tested with generated audio; physical audio capture, latency calibration, and iPad Safari recording still need device testing. AE-20 device discovery has been verified. See the [validation record](docs/validation.md) for test coverage and results.

- **Alignment:** the score always follows its written tempo. Direct matching uses the selected score part's sounding pitch classes and attack evidence. For backing, available accompaniment parts are placed on the selected score's canonical repeat route; a reviewed demonstration can bridge through shared accompaniment content. A melody-only score may not supply enough evidence for accompaniment with no melody. Original audio is reviewed on its actual waveform, paired with musical score positions. Conflicting instrument metadata, weak phrase entries, and repeated candidate phrases require review. Stored reference identity follows note content and route, so a written-tempo-only change does not discard its source positions. Distributed phrase positions constrain full-content refinement; every pitched attack is checked, including notes outside the selected phrases. Analyzed-but-unsupported notes and unfinished analysis have separate musical ranges. Evidence thresholds are checks, not a calibrated accuracy score. Sparse or repetitive passages and different arrangements require review. Conformation preserves musical boundaries, but the current pitch-preserving stretcher can still shift transients inside a segment; fine onset alignment remains under development.
- **Inputs:** up to 160 MB per file, 15 minutes per audio track, and 512 MB per project backup. Large sessions can reach device memory limits before these limits. Alignment may request a shorter input when its comparison limit is reached.
- **Score synth:** the flute and piano options are synthesized cues for checking notes and timing. Choose the instrument before playback. **Score synth** and **Click** can be toggled independently during playback and recording. Choosing an instrument does not change imported recordings.
- **Mobile use:** the layout supports touch and tablet screens. On iPad, a deployed HTTPS site can be added to the Home Screen.

## Deployment

Dripping builds to a static site and can run on GitHub Pages, Cloudflare Pages, or another HTTPS static host.

### GitHub Pages

The repository includes a [deployment workflow](.github/workflows/deploy-pages.yml).

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Merge a pull request into `main` or push an update to `main`. To deploy manually, open **Actions → Deploy to GitHub Pages → Run workflow** and select `main`.
3. Wait for the workflow to finish, then open the published URL shown in **Settings → Pages**.

Updates to `main` automatically run the deployment workflow: tests must pass and the production build must succeed before Pages deploys. Pull requests and other branches run the separate **Check** workflow. The manual deployment entry point remains available.

To use a custom domain, add it in GitHub's Pages settings before configuring DNS. For a subdomain, create a CNAME pointing to the repository owner's `<username>.github.io` hostname, without a repository path. If Cloudflare manages your DNS, use **DNS only** when GitHub serves the site directly. Enable **Enforce HTTPS** in GitHub once its certificate is ready. See [GitHub's custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

### Cloudflare Pages

Connect your GitHub repository in **Workers & Pages → Create application → Pages → Connect to Git**, then use these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank |
| Environment variable | `NODE_VERSION=22` |

With Git integration enabled, pushes to the production branch trigger a new deployment. Add a custom domain through the Pages project's **Custom domains** settings. See the [Cloudflare Pages setup guide](https://developers.cloudflare.com/pages/get-started/git-integration/).

### Other static hosts

```sh
npm ci
npm run build
npm run preview
```

The preview command serves the production build locally. Publish the entire `dist/` directory to your host; opening its `index.html` directly as a file is not supported. Relative asset paths allow deployment under a path such as `/dripping/`.

The build includes a service worker for offline use and an `_headers` file for compatible hosts. On other hosts, configure `index.html` and `sw.js` to revalidate on each request, while allowing hashed assets to cache. When an update is available, the app prompts for a reload rather than interrupting a recording.

## Development

```sh
npm run check  # TypeScript checks
npm test       # Unit and regression tests
npm run build  # Verify/download pinned models, production build, notices and offline cache
```

With the development server running, `/tests/browser.html` exercises audio processing, recording, storage, backup/restore, and WAV rendering using generated audio. `/tests/recording-ui.html` opens the complete app with a generated 440 Hz input for recording checks. Neither page requests a physical microphone; both use the local development project library and are excluded from production builds.

`/tests/timeline-layout.html` checks ruler/grid positions and track-row geometry with variable meter, nonlinear alignment, timeline zoom and enlarged mobile text. It also covers audio-only timing and a muted demonstration track.

| Directory | Purpose |
| --- | --- |
| `src/components/` | Score, timeline, and workflow dialogs |
| `src/lib/` | Score parsing, alignment, playback, recording, and storage |
| `src/workers/` | Background audio processing and input capture |
| `tests/` | Generated fixtures, regression tests, and browser checks |
| `scripts/` | Build helpers and optional macOS icon generation |

See [product scope](docs/product.md) for the application's design boundaries. Keep personal scores, audio, recordings, and project exports out of contributions.

## License

Dripping application software is licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE). The complete application source and release history are available at [soapisnotfat/dripping](https://github.com/soapisnotfat/dripping). Dependencies retain their own licenses and notices in [THIRD_PARTY.md](THIRD_PARTY.md).

Dripping does not apply its software license to your imported PDFs, MusicXML, audio, recordings or other user content. Their existing rights remain unchanged.

PDF recognition uses the pinned browser SDK in `vendor/sheetscan/`; its source and licenses are linked there. `scripts/prepare-sheetscan.mjs` verifies every vendored file, downloads official model release archives, and verifies both archive and raw ONNX SHA-256 values. Models are excluded from Git history and ordinary service-worker precaching. Recognition code/models are loaded only for PDF import. Runtime dependencies are static downloads from the SDK’s pinned CDN versions; no local program or inference service is required. The host owns the only service worker. On a fresh browser without JSPI it can reload once, before the app mounts or files are selected, to establish shared memory. Existing tabs and later updates retain the explicit save/update flow. Desktop browser checks do not establish physical iPad/iPhone performance or a general transcription accuracy percentage.
