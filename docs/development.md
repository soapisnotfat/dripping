# Development and architecture

[Back to the project](../README.md) · [Contributing](../CONTRIBUTING.md) · [Validation record](validation.md)

## Setup and commands

Use **Node.js 22.12.0 or later** and npm. The exact commands and dependency versions are in [package.json](../package.json) and [package-lock.json](../package-lock.json).

```sh
npm ci
npm run dev
```

`npm run dev` serves the app on `127.0.0.1`, normally port 5173. Both development startup and production builds run [prepare-sheetscan.mjs](../scripts/prepare-sheetscan.mjs). On an empty cache, it downloads the pinned model archives and runtime assets, verifies their checksums, and prepares same-origin static files. No local recognition service is needed. See [PDF import](pdf-import.md) for the resource layout.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Prepare recognition resources and start Vite |
| `npm run check` | Run TypeScript checks |
| `npm run format` | Format first-party source, tests, scripts, and configuration |
| `npm run format:check` | Check that formatting without writing changes |
| `npm test` | Run the Vitest unit and regression suite |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Prepare resources, check TypeScript, build the site, then generate notices and offline cache |
| `npm run preview` | Serve the existing production build locally |

Formatting uses the pinned Prettier version. Vendored files, generated resources, dependency lockfiles, and Markdown are outside its scope.

For a production check, run `npm run build` followed by `npm run preview`. Publish the entire `dist/` directory; see [deployment](deployment.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| [`src/main.tsx`](../src/main.tsx) | Browser bootstrap and React mount |
| [`src/App.tsx`](../src/App.tsx) | Workspace state, persistence queue, transport, recording, and PDF job lifecycle |
| [`src/components/`](../src/components/) | Score/PDF views, timeline, dialogs, meters, and editing controls |
| [`src/lib/`](../src/lib/) | Project operations, score/time interpretation, alignment, audio, recording, and storage |
| [`src/workers/`](../src/workers/) | Audio processing worker and recording AudioWorklet |
| [`src/styles.css`](../src/styles.css) | Workspace layout, themes, and responsive styles |
| [`tests/`](../tests/) | Generated fixtures, unit/regression tests, and browser test pages |
| [`scripts/`](../scripts/) | Recognition-resource preparation, notices, service worker, and optional macOS icon generation |
| [`public/`](../public/) | Static app icons, web manifest, and host headers |
| [`vendor/sheetscan/`](../vendor/sheetscan/) | Pinned recognition SDK, provenance, checksums, and third-party notices |
| [`docs/`](./) | User, development, deployment, and validation references |

Workflow dialogs live in [`src/components/dialogs/`](../src/components/dialogs/index.ts): import, alignment, export, and the shared modal. [`Icon.tsx`](../src/components/Icon.tsx) and [`Brand.tsx`](../src/components/Brand.tsx) hold the shared application marks.

The app is a React/TypeScript client built with Vite. It has no application server. `src/lib/` uses named modules for the musical and audio domains; start with the domain below rather than reading every file in order.

## Code paths

| Concern | Entry points |
| --- | --- |
| Project types, import, edits, undo/redo | [`types.ts`](../src/lib/types.ts), [`project.ts`](../src/lib/project.ts), [`pdf-project.ts`](../src/lib/pdf-project.ts) |
| MusicXML/MXL parsing and score display | [`score.ts`](../src/lib/score.ts), [`score-display.ts`](../src/lib/score-display.ts), [`ScoreView.tsx`](../src/components/ScoreView.tsx) |
| Written tempo, meter, repeat route, and clip timing | [`time.ts`](../src/lib/time.ts), [`score-time.ts`](../src/lib/score-time.ts), [`clip-time.ts`](../src/lib/clip-time.ts) |
| Automatic alignment and musical evidence | [`alignment.ts`](../src/lib/alignment.ts), [`score-reference.ts`](../src/lib/score-reference.ts), [`phrase-refinement.ts`](../src/lib/phrase-refinement.ts), [`alignment-evidence.ts`](../src/lib/alignment-evidence.ts) |
| Manual alignment edits | [`alignment-edit.ts`](../src/lib/alignment-edit.ts), [`SourcePoint.tsx`](../src/components/SourcePoint.tsx) |
| Playback and worker jobs | [`transport.ts`](../src/lib/transport.ts), [`jobs.ts`](../src/lib/jobs.ts), [`audio.worker.ts`](../src/workers/audio.worker.ts) |
| Audio rendering, mixing, and WAV export | [`audio.ts`](../src/lib/audio.ts), [`mix.ts`](../src/lib/mix.ts), [`master.ts`](../src/lib/master.ts) |
| Input selection, recording, and recovery chunks | [`input.ts`](../src/lib/input.ts), [`recorder.ts`](../src/lib/recorder.ts), [`recorder.worklet.js`](../src/workers/recorder.worklet.js) |
| IndexedDB persistence and portable backups | [`storage.ts`](../src/lib/storage.ts) |
| Browser PDF adapter and bootstrap | [`pdf-import.ts`](../src/lib/pdf-import.ts), [`browser-bootstrap.ts`](../src/lib/browser-bootstrap.ts), [PDF integration guide](pdf-import.md) |
| Built-in original example | [`demo.ts`](../src/lib/demo.ts) |

The written score sets the project clock, including its tempo changes, meter, and expanded repeat route. Alignment maps source-audio positions onto that clock. Candidate evidence and accepted edits remain distinct; conforming audio creates a new asset while preserving the original. The project model records clips and undo history separately from source assets.

Audio processing runs through `AudioJobs` in a Web Worker. Recording captures the selected input through an AudioWorklet and commits recoverable chunks to IndexedDB. The UI's persistence queue saves project revisions with their pending assets; the saved indicator reflects the latest persisted revision.

## Storage and generated files

Browser project data lives in IndexedDB, not in this checkout or on the static host. Small interface preferences live in local storage. Libraries are scoped to the browser and origin; changing from localhost to a hosted URL does not move projects. `.drippingproj` files are explicit user exports.

| Path or storage | Contents | Tracked in Git? |
| --- | --- | --- |
| `vendor/sheetscan/` | Frozen SDK files, pin, runtime manifest, licenses, and source archive | Yes |
| `.cache/sheetscan/` | Verified recognition models and runtime download cache | No |
| `public/vendor/sheetscan/` | Prepared, versioned static recognition files | No |
| `dist/` | Deployable production site, notices, and service worker | No |
| Browser IndexedDB | Projects, imported assets, takes, and recovery chunks | No |

Do not hand-edit prepared runtime files. The [pin](../vendor/sheetscan/pin.json), [runtime manifest](../vendor/sheetscan/runtime-lock.json), and preparation script define them. Preserve the frozen recognition package and model hashes when changing unrelated app code.

## Browser checks

With `npm run dev` running, open the following pages on its printed origin. They use generated data and the local development project library; they are excluded from the production build.

| Page | Exercises |
| --- | --- |
| `/tests/browser.html` | Worker audio processing, scheduled recording, interruption recovery, storage, backup/restore, and WAV rendering |
| `/tests/recording-ui.html` | Complete app with a generated 440 Hz input; no physical microphone request |
| `/tests/timeline-layout.html` | Ruler/grid positions and row geometry across variable meter, alignment, zoom, and enlarged mobile text |

These checks do not replace physical audio-interface or mobile Safari testing. The [validation record](validation.md) separates generated-input browser checks from hardware observations. Use synthetic, inspectable fixtures in contributions and keep personal scores, recordings, and project exports out of Git.
