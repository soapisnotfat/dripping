# Browser PDF import

PDF recognition is a lazy adapter around the pinned SheetScan SDK. It runs in browser workers and fetches only static files. There is no score upload, inference API, local program or user installation. Existing MusicXML/MXL import remains available.

`vendor/sheetscan/pin.json` identifies the exact public source, SDK/archive/notices checksums, official model release URLs, archive checksums and raw ONNX checksums. The build verifies the vendored files, downloads missing models into an ignored cache and copies a versioned package into the static output. The embedded PDF.js worker is decoded into a same-origin module without changing its bytes. No private scores, labels or diagnostic candidate manifests are included. Ordinary PWA installation excludes the recognition directory; the SDK caches models only after a PDF import.

Conversion produces MusicXML in memory. Dripping's existing parser must accept it before the project/audio/source assets can commit in one IndexedDB transaction. Cancellation aborts conversion or the pending transaction and retains the selected files. The previous project is not replaced on failure. Project backups retain original PDFs, generated XML, the SDK audit and minimal model/source provenance; restoration remaps every asset reference. Export also offers the current MusicXML and original PDFs independently.

JSPI is preferred. For a new browser without JSPI, the host service worker can establish COOP/COEP isolation with one bootstrap reload before React mounts or any files can be selected. A session guard prevents loops. Existing controlled tabs and waiting updates stay in the normal explicit save/update flow. The SDK never registers a service worker or reloads the page. Simulated non-JSPI Chrome is a shared-memory bridge test, not a physical Safari/iOS qualification.

# License decision for release review

The application license remains unchanged. The following is a proposal for the owner to approve, not an adopted license declaration:

- Apply AGPL-3.0 to the integrated application release and add the matching root license/README notice. Keep compatible component notices and provide the complete corresponding application source from its exact public release commit.
- Retain the SheetScan AGPL license and exact corresponding-source link, the homr archive, and all glyph/font notices. Keep browser-accessible source/license links.
- Keep the packaging changes in the public application source. The host externalizes the PDF.js worker and controls isolation/caching; recognition code and model weights retain their pinned hashes. PDF.js, ONNX Runtime, Pyodide and OCR dependencies remain separately identified by their distributions and notices.

Publishing this integration is pending the owner's final application-license decision and joint model/browser review. This document does not change the application's existing license status.
