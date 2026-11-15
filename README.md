# Dripping

A local-first MusicXML practice and recording studio for desktop and tablet browsers.

## Develop

Node.js 22.12+ is required.

```sh
npm ci
npm run dev
```

## Verify and build

```sh
npm test
npm run build
npm run preview
```

The production site is the `dist/` directory. Serve it over HTTPS for recording and installation as a PWA. `localhost` is also a secure context for local development. No backend or API keys are needed.

Product scope and acceptance criteria: [docs/product.md](docs/product.md).

Personal audio, scores, recordings, project exports and credentials do not belong in this repository.
