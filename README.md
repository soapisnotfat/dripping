# Dripping

Dripping is a browser app for practicing and recording music with sheet music and backing tracks. Import a MusicXML score, follow it during playback, loop a difficult passage, and record your instrument on a separate track. Export your takes to continue editing in Logic Pro or GarageBand.

Audio, scores, and projects stay in your browser. No account or backend is required. The interface supports English and Chinese.

[Open Dripping](https://soapisnotfat.github.io/dripping/) · [Report a bug](https://github.com/soapisnotfat/dripping/issues)

## Features

- Interactive sheet music with note selection and playback tracking.
- Passage looping and practice speeds from 50% to 150%, with pitch preserved.
- Score-to-audio alignment with editable timing anchors.
- Mono or stereo recording from a selected audio input, with count-in and optional monitoring.
- Non-destructive clip editing, fades, track volume and pan, and undo/redo.
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

1. **Import your music.** Add a `.musicxml`, `.xml`, or `.mxl` score and audio files. Assign each file its role: Score, Backing, or Demo. You can also start with just a score or audio. PDF scores must be converted to MusicXML before import.
2. **Set the timing reference.** Open **Alignment**, analyze the demonstration track, and listen to it alongside the score tones. Adjust the timing anchors as needed, then choose **Use as reference**. Automatic alignment is a starting point that needs listening and review.
3. **Align the backing.** Analyze the backing track and review its anchors. Use **Conform to reference** if you want to adjust its timing to match the reference. The original audio is preserved. Changing the reference later does not automatically reconform other tracks.
4. **Practice a passage.** Click a note to seek, or drag across notes or the timeline to select a range. Loop the selection or slow down playback. Use **Edit selection** for splitting, trimming, fades, or punch-in recording.
5. **Record a take.** In **Audio input**, choose your device and channels, then select **Test connection**. Set the count-in and timing correction before recording. Dripping captures the selected input separately from playback and preserves the original take when you edit or replace a passage.
6. **Export your work.** Open **Export** to download stems, a mix, original takes, or a project backup.

## Saving and exporting

Projects save automatically in the current browser. Each browser and site address has its own project library, so a project saved on localhost will not appear automatically on a deployed site or another device.

Export a **Project backup** regularly. Browser storage can be cleared or evicted. To move a project, open its `.drippingproj` file through **New practice** on the destination browser. Import creates a separate project and checks the included assets for integrity.

| Export | Contents |
| --- | --- |
| WAV stems | One 48 kHz, 32-bit float WAV per selected track, with a shared start and length. Clip edits and fades are included; track volume and pan are excluded. |
| Mix WAV | The selected tracks combined with their volume and pan settings. Optional headroom reduction lowers gain when needed. |
| Original dry takes | Unedited input recordings at their original capture sample rate and practice speed. |
| Project backup | A `.drippingproj` file containing source assets, recordings, edits, and undo history. |

Stems and mixes use the project's original tempo. For example, a take recorded at 75% practice speed is fitted to that tempo in the arrangement, while its original take download retains the slower recording.

After an interrupted recording, Dripping can recover audio chunks that were saved before the interruption.

## Compatibility and limits

Dripping is in early development. Desktop browser workflows have been tested with generated audio; physical audio capture, latency calibration, and iPad Safari recording still need device testing. AE-20 device discovery has been verified. See the [validation record](docs/validation.md) for test coverage and results.

- **Alignment:** sparse or repetitive accompaniment, or a different arrangement, may require manual timing anchors or a matching demonstration track. Until a timing reference is chosen, the score follows its written tempo.
- **Inputs:** up to 160 MB per file, 15 minutes per audio track, and 512 MB per project backup. Large sessions can reach device memory limits before these limits. Alignment may request a shorter input when its comparison limit is reached.
- **Reference tones:** the flute and piano options are simple synthesized cues for checking notes and timing.
- **Mobile use:** the layout supports touch and tablet screens. On iPad, a deployed HTTPS site can be added to the Home Screen.

## Deployment

Dripping builds to a static site and can run on GitHub Pages, Cloudflare Pages, or another HTTPS static host.

### GitHub Pages

The repository includes a [deployment workflow](.github/workflows/deploy-pages.yml).

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Open **Actions → Deploy to GitHub Pages → Run workflow** and select `main`.
3. Wait for the workflow to finish, then open the published URL shown in **Settings → Pages**.

This workflow tests, builds, and deploys the app when run manually. Pushes and pull requests run the separate **Check** workflow; they do not trigger a Pages deployment.

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
npm run build  # Production build, dependency notices, and offline cache
```

With the development server running, `/tests/browser.html` exercises audio processing, recording, storage, backup/restore, and WAV rendering using generated audio. `/tests/recording-ui.html` opens the complete app with a generated 440 Hz input for recording checks. Neither page requests a physical microphone; both use the local development project library and are excluded from production builds.

| Directory | Purpose |
| --- | --- |
| `src/components/` | Score, timeline, and workflow dialogs |
| `src/lib/` | Score parsing, alignment, playback, recording, and storage |
| `src/workers/` | Background audio processing and input capture |
| `tests/` | Generated fixtures, regression tests, and browser checks |
| `scripts/` | Build helpers and optional macOS icon generation |

See [product scope](docs/product.md) for the application's design boundaries. Keep personal scores, audio, recordings, and project exports out of contributions.

## License

A license for the application code has not been specified. Dependency licenses and notices are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
