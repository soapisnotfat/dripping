# Third-party components

Runtime versions are pinned in `package-lock.json`. The SheetScan package is checked against `vendor/sheetscan/pin.json`; host packaging moves its embedded PDF.js worker to a same-origin file without changing the decoded worker bytes.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | https://github.com/facebook/react |
| OpenSheetMusicDisplay | 2.3.1 | BSD-3-Clause | https://github.com/opensheetmusicdisplay/opensheetmusicdisplay |
| SoundTouchJS core | 2.1.1 | MPL-2.0 | https://github.com/cutterbl/SoundTouchJS/tree/main/packages/core |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| idb | 8.0.4 | ISC | https://github.com/jakearchibald/idb |

The production `third-party-notices.txt` includes license texts for the runtime components and bundled renderer dependencies. SoundTouchJS source is available from its linked repository and from the exact `@soundtouchjs/core@2.1.1` npm source distribution. The application does not restrict recipients from exercising the rights granted by those component licenses. Retain the notices with redistributed builds.

The generated Morning Drops exercise and icon paths are original application assets. No user-provided or copyrighted music was added to this repository.

PDF recognition uses the AGPL-3.0 SheetScan fork at [the pinned corresponding source](https://github.com/soapisnotfat/sheetscan/tree/ac8688002aff2069ab40b7d3811f82699249faa6). Its license, homr archive and glyph/font notices are retained in `vendor/sheetscan/`. Recognition models are fetched at build time from official homr release archives, with both archive and raw ONNX SHA-256 verification. Browser runtime dependencies use the SDK’s pinned public CDN versions; no score is posted to them. The browser’s recognition package exposes its license and source links alongside the PDF import controls.
