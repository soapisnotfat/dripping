# Browser PDF import

PDF recognition is a lazy adapter around the pinned SheetScan SDK. It runs in browser workers and fetches only static files. There is no score upload, inference API, local program or user installation. Existing MusicXML/MXL import remains available.

`vendor/sheetscan/pin.json` identifies the exact public source, SDK/archive/notices checksums, official model release URLs, archive checksums and raw ONNX checksums. The build verifies the vendored files, downloads missing models into an ignored cache and copies a versioned package into the static output. The embedded PDF.js worker is decoded into a same-origin module without changing its bytes. No private scores, labels or diagnostic candidate manifests are included. Ordinary PWA installation excludes the recognition directory; the SDK caches models only after a PDF import.

Conversion produces MusicXML in memory. Dripping's existing parser must accept it before the project/audio/source assets can commit in one IndexedDB transaction. Cancellation aborts conversion or the pending transaction and retains the selected files. The previous project is not replaced on failure. Project backups retain original PDFs, generated XML, the SDK audit and minimal model/source provenance; restoration remaps every asset reference. Export also offers the current MusicXML and original PDFs independently.

JSPI is preferred. For a new browser without JSPI, the host service worker can establish COOP/COEP isolation with one bootstrap reload before React mounts or any files can be selected. A session guard prevents loops. Existing controlled tabs and waiting updates stay in the normal explicit save/update flow. The SDK never registers a service worker or reloads the page. Simulated non-JSPI Chrome is a shared-memory bridge test, not a physical Safari/iOS qualification.

# Software and content licenses

The owner has adopted AGPL-3.0-only for the integrated Dripping application. The root `LICENSE`, package metadata and README identify that license. Complete corresponding application source and release history are public at https://github.com/soapisnotfat/dripping. The browser interface also links to this source.

SheetScan retains its AGPL license and exact corresponding-source link, the homr archive, and the glyph/font notices. The host's PDF.js worker packaging and isolation/caching code are included in the public application source. Other components retain their respective licenses and notices.

The application software license does not relabel imported PDFs, MusicXML, audio or takes. Dripping preserves their contents and existing rights; it adds no AGPL declaration to those user assets.
