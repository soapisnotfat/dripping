# Third-party components

[Back to the project](README.md) · [Application license](LICENSE) · [PDF runtime](docs/pdf-import.md)

Dripping application software is AGPL-3.0-only; user-imported scores, audio and takes retain their existing rights. Each component below retains its own license.

Runtime versions are pinned in [package-lock.json](package-lock.json). The SheetScan package is checked against [vendor/sheetscan/pin.json](vendor/sheetscan/pin.json); host packaging moves its embedded PDF.js worker to a same-origin file without changing the decoded worker bytes.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | [facebook/react](https://github.com/facebook/react) |
| OpenSheetMusicDisplay | 2.3.1 | BSD-3-Clause | [opensheetmusicdisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) |
| SoundTouchJS core | 2.1.1 | MPL-2.0 | [SoundTouchJS core](https://github.com/cutterbl/SoundTouchJS/tree/main/packages/core) |
| fflate | 0.8.3 | MIT | [101arrowz/fflate](https://github.com/101arrowz/fflate) |
| idb | 8.0.4 | ISC | [jakearchibald/idb](https://github.com/jakearchibald/idb) |

The production `third-party-notices.txt` includes license texts for the runtime components and bundled renderer dependencies. SoundTouchJS source is available from its linked repository and from the exact `@soundtouchjs/core@2.1.1` npm source distribution. The application does not restrict recipients from exercising the rights granted by those component licenses. Retain the notices with redistributed builds.

The generated Morning Drops exercise and icon paths are original application assets. No user-provided scores or recordings are included.

PDF recognition uses the AGPL-3.0 SheetScan fork at [the pinned corresponding source](vendor/sheetscan/SOURCE.txt). Its license, homr archive and glyph/font notices are retained in `vendor/sheetscan/`. Recognition models are fetched at build time from official homr release archives, with both archive and raw ONNX SHA-256 verification. The build also fetches runtime dependencies from the URLs in [runtime-lock.json](vendor/sheetscan/runtime-lock.json), verifies their sizes and SHA-256 hashes, and packages them as same-origin static files. The browser loads recognition resources from the app origin and does not upload scores to a recognition service. The browser’s recognition package exposes its license and source links alongside the PDF import controls.
