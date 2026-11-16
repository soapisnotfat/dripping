# Contributing

For local setup and code navigation, read [development](docs/development.md). For expected behavior, read the [user guide](docs/user-guide.md) and [product scope](docs/product.md).

## Report a problem

Use [GitHub Issues](https://github.com/soapisnotfat/dripping/issues). Include the steps to reproduce, expected and actual behavior, browser/version, operating system, and relevant audio-device/channel settings. For PDF failures, include the displayed error and phase when available.

A small generated score or audio fixture is the most useful reproduction. Do not attach personal recordings, private scores, credentials, or media you do not have permission to share. Browser-emulated mobile results and physical-device results should be identified separately.

## Propose a change

Keep changes focused on one problem. For a large change, describe the intended behavior in an issue before spending time on its implementation. Follow the existing TypeScript/React modules and keep source assets intact when changing project edits, recording, or export behavior.

Before opening a pull request:

```sh
npm run format:check
npm run check
npm test
npm run build
```

Use `npm run format` for the first-party files covered by the formatter.

Check the relevant browser flow when changing user-visible behavior. In the pull request, explain the problem, resulting behavior, checks run, and any device-specific behavior still unverified. Documentation-only changes can be checked by reading the rendered Markdown and verifying links and commands.

Recognition SDK files, runtime manifests, model pins, and third-party notices in `vendor/` are versioned dependencies. Do not reformat them or change their hashes as part of unrelated work. Generated resources, caches, builds, private scores, audio, and project backups do not belong in contributions.

The application uses [AGPL-3.0-only](LICENSE). Preserve dependency notices and attribution; imported user content retains its existing rights.
