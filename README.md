# Dripping

乐谱、伴奏和你的演奏，在同一个地方。A local-first practice and recording studio for desktop and tablet browsers.

Import prepared **MusicXML + backing audio + demonstration audio**. Practice with an interactive score, record a dry input while the backing plays, and take aligned WAV stems into Logic Pro or GarageBand. PDF transcription is outside this application.

## Run locally

Requires Node.js **22.12 or later**. All runtime dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. For the production build:

```sh
npm test
npm run build
npm run preview
```

The production site is **`dist/`**. No backend, account, API key, or media upload is required. Recording needs HTTPS or localhost. Opening `index.html` directly with a `file://` URL will not work.

## First practice

1. Choose **New practice**, then add a `.musicxml`, `.xml`, or `.mxl` score and your audio. Set each file's role to Score, Backing, or Demo. **Try an example** generates an original, inspectable practice exercise.
2. Open **Alignment**. Analyze the demonstration first, audition it with the score tones, adjust any anchors, and choose **Use as reference**. The score then follows this track's original timing.
3. Analyze the backing. An accepted demonstration helps match shared accompaniment. **Conform to reference** creates a new playable audio asset while preserving the original. Its edits can be undone. Changing the reference later does not automatically rebuild other tracks.
4. Click a note to seek. Drag across notes or the timeline to select a passage. **Edit selection** offers the same commands as right-click, including split, clear, keep only selection, fades, and punch-in. Loop a selection or practice at 50–150% speed without shifting pitch.
5. In **Audio input**, choose a device and mono/stereo channel pair, count-in, and timing correction. Record with headphones. Backing, reference tones, and clicks are routed separately from the captured input. Each original take is preserved, including when a later take replaces part of the edit.
6. **Export** creates equal-length WAV stems, a mix, original dry takes, or a complete `.drippingproj` backup. Open that backup as a new project on another browser or device.

The score-tone instruments are simple synthesized flute/piano cues. They are useful for checking notes and timing, not a sampled instrument library.

## Data and exports

- Project metadata, original assets, edits, undo history, and takes live in IndexedDB on the current browser origin. Changing ports or deployment domains creates a separate library.
- Browser storage can be cleared or evicted. A `.drippingproj` export is the portable backup; its assets are SHA-256 checked on import. Import creates a new project rather than overwriting an existing one.
- Recording uses an AudioWorklet and writes PCM chunks incrementally. A suspended or interrupted session can recover committed chunks. Audio not yet captured or committed cannot be recovered.
- WAV stems are 48 kHz, 32-bit IEEE float, at the project’s original speed, with the same starting point and length. They include clip edits and fades, but exclude track fader and pan. The mix includes selected tracks with fader and pan; the optional headroom setting reduces gain only when necessary.
- Original take downloads retain their capture sample rate and practice-speed timing. A take recorded while practicing at 75% remains the untouched slower take; the arrangement renders it into the original project timeline.
- Import limits: 160 MB per file, 15 minutes per audio track, 512 MB per project backup. Large sessions may reach device memory limits sooner. Automatic alignment has a bounded comparison size and reports when a shorter input is needed.

## Deploy

Build once and publish **all of `dist/`** to an HTTPS static host. Relative asset paths support a repository subpath such as `/dripping/`.

For GitHub Pages, after creating the remote repository and pushing this Git history:

1. Set **Settings → Pages → Source → GitHub Actions**.
2. Run **Deploy to GitHub Pages** in Actions. It tests and builds before publishing.

Deployment is manually triggered. Ordinary pushes and pull requests run the Check workflow and produce a build artifact. No remote repository or hosted site is created by this local checkout. The workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Netlify / Cloudflare Pages can also use `npm ci && npm run build`, output directory `dist`. The included `_headers` prevents stale entrypoint/service-worker caching on hosts that support that format. On other hosts, give `index.html` and `sw.js` a no-cache policy and allow hashed assets to cache.

The production build caches the application shell for offline use after the first successful load. Projects remain in IndexedDB. A new version prompts for a reload; it does not force a reload during recording. On iPad, open the HTTPS deployment in Safari and add it to the Home Screen. Physical iPad/USB hardware support still needs validation on the target devices.

## Verification

```sh
npm run check
npm test
npm run build
```

With the development server running, open `/tests/browser.html` and choose **Run browser checks**. This uses generated audio and temporary projects to exercise the actual worker, AudioWorklet, IndexedDB, backup/restore, and WAV rendering. It does not request a microphone. `/tests/recording-ui.html` mounts the complete app with a generated 440 Hz input for UI recording checks; it uses the local development library. These pages are not included in production.

See [validation results](docs/validation.md), [product scope](docs/product.md), and [third-party notices](THIRD_PARTY.md). The current verification distinguishes browser tests from hardware checks; it does not claim that arbitrary real recordings align automatically or that physical USB latency has been calibrated.

## Repository

- `src/components/`: score, timeline, and workflow dialogs.
- `src/lib/`: MusicXML structure, time maps, audio processing, transport, recording, and project persistence.
- `src/workers/`: background audio processing and the PCM input worklet.
- `tests/`: synthetic fixtures and regression/browser checks.
- `scripts/`: offline-cache generation and optional macOS icon regeneration.

Personal audio, scores, recordings, project exports, and credentials do not belong in Git. The included demonstration is an original generated exercise. No license for the original application code has been selected yet; dependency notices apply to their respective components.
