# Original SDK qualification fixture

The original score and fixture content in `fixture.musicxml` and `fixture.pdf` are dedicated to **CC0-1.0**. Embedded font software retains its own license: Liberation Serif uses SIL OFL 1.1 (see `Liberation-FONT-NOTICE.txt`) and Leipzig uses SIL OFL 1.1 (see [the bundled Leipzig notice](../../../vendor/sheetscan/Leipzig-LICENSE.txt)). The content dedication does not relicense those font programs. They contain seven notes in three 4/4 measures, quarter=96, a split opening `attributes` declaration, and the explicit printed header “For Tenor Saxophone”. There is no private score or recording here.

The source was engraved with Verovio 6.4.1 (`pageWidth:1800`, `pageHeight:1200`, `scale:55`, `adjustPageHeight:true`, `breaks:'none'`, no header/footer). Its SVG was printed by Chromium on A4 with 15mm margins. The HTML print header used serif text: “For Tenor Saxophone” (20px) and “USB Dawn — original CC0 qualification fixture” (17px). `qualification.json` records hashes of the exact PDF/XML used and browser results. PDF bytes are retained because regenerated PDFs can differ in metadata and font embedding.

`baseline.musicxml` and `candidate.musicxml` are the actual outputs of the pinned v14 and v15 browser SDKs. `clef-ledger.json` records the observed clefs by part, measure and onset: two G2 declarations at P1/measure1/onset0 become one. Written pitch/duration/grace/tie signatures match all seven authored notes; tempo96 remains, and the candidate adds Tenor Saxophone's explicit -14-semitone transposition. Forced shared-memory and JSPI candidate outputs have the same signatures. This is a controlled regression, not a population accuracy estimate or a reproduction of the user's private duplicate-tempo screenshot.

To repeat against the prepared packages, run `node scripts/prepare-sheetscan.mjs`, then:

```sh
python tests/fixtures/pdf-metadata/qualify.py --output /tmp/pdf-sdk-qualification
```

This optional developer harness requires Python Playwright and Chromium (`--chromium` selects its executable). These are test tools; the application and recognizer remain browser-only. The harness serves the prepared current and previous SDKs on localhost, performs three real PDF conversions, writes outputs, and checks written notes, clef count, source tempo, transposition and bridge parity. It also verifies that the SDK does not change its host URL or install a service worker. It takes longer than the normal unit suite because the ONNX recognizer actually runs.

The direct pipeline/annotation source fixtures additionally cover pickup/system transitions, intentional later clefs and tempos. The separate woodwind matrix fixtures and their source provenance are in `../pdf-sax-metadata.json`.
