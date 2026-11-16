# Browser PDF import

[Back to the project](../README.md) · [Development](development.md) · [Validation record](validation.md)

## Runtime and resources

PDF recognition starts in the workspace after creation, through the pinned SheetScan SDK. Original PDFs and audio first commit together as a durable pending project. A PDF.js raster preview streams pages independently of the recognition models; project configuration remains editable. It runs in browser workers and fetches only static files. There is no score upload, inference API, local program or user installation. Existing MusicXML/MXL import remains available.

Recognition runtime, OCR language data and models are served from the application origin, with no browser CDN dependency. The current SDK package is `v14-static-runtime`; its recognizer remains `v13-woodwind-pdf`. Existing model URLs remain stable so cached v13 weights can be reused. The pin is the authoritative version reference.

[`vendor/sheetscan/pin.json`](../vendor/sheetscan/pin.json) identifies the exact public source, SDK/archive/notices checksums, official model release URLs, archive checksums and raw ONNX checksums. [`scripts/prepare-sheetscan.mjs`](../scripts/prepare-sheetscan.mjs) verifies the vendored files, downloads missing models into an ignored cache and copies a versioned package into the static output. The embedded PDF.js worker is decoded into a same-origin module without changing its bytes. No private scores, labels or diagnostic candidate manifests are included. Ordinary PWA installation excludes the recognition directory; the SDK caches models only after a PDF import.

Prepared files are generated in ignored `public/vendor/sheetscan/`; verified downloads live in ignored `.cache/sheetscan/`. The production build copies prepared resources into `dist/vendor/sheetscan/`. Models are not committed to Git. See the [storage map](development.md#storage-and-generated-files) for application data versus build resources.

## Project lifecycle

Conversion produces MusicXML in memory. After the normal parser accepts it, only the new score and audit assets attach to the latest revision of that same project/source. Rename, mix and newly added audio are preserved. Switching projects pauses the old job; reloads and pending/failed backups offer explicit Retry without discarding the original PDF. Both pending and complete backups remap source references. Export offers current MusicXML and original PDFs independently. Download percentages describe a resource with a known byte total; page-entry counts and unknown phases do not claim overall completion.

## Browser bootstrap

JSPI is preferred. For a new browser without JSPI, the host service worker can establish COOP/COEP isolation with one bootstrap reload before React mounts or any files can be selected. A session guard prevents loops. Existing controlled tabs and waiting updates stay in the normal explicit save/update flow. The SDK never registers a service worker or reloads the page. Simulated non-JSPI Chrome is a shared-memory bridge test, not a physical Safari/iOS qualification.

## Software and content licenses

Dripping is licensed under [AGPL-3.0-only](../LICENSE). Complete corresponding application source and release history are public at [soapisnotfat/dripping](https://github.com/soapisnotfat/dripping). The browser interface also links to this source.

SheetScan retains its AGPL license and exact corresponding-source link, the homr archive, and the glyph/font notices. The host's PDF.js worker packaging and isolation/caching code are included in the public application source. Other components retain their respective licenses and notices.

The application software license does not relabel imported PDFs, MusicXML, audio or takes. Dripping preserves their contents and existing rights; it adds no AGPL declaration to those user assets.
