# Independent woodwind scores

The six complete scores come from the public PDMX archive. The manifest fixes each archive path, score ID, license, exact MusicXML and the PDF rendered from that MusicXML. The selection used the original notation and PDMX's `license_conflict=False` records. It includes a CC0 flute composition by Brandon Moran, traditional recorder and clarinet melodies, and historic fife and piccolo tunes. [PDMX archive and copyright metadata](https://doi.org/10.5281/zenodo.15571083)

The original MusicXML files are the reference answers. Verovio 6.4.1 engraved them in Bravura, Leipzig and Leland using an A4 layout and the scale recorded per score. The two-page score limits each page to two systems. Chromium 151.0.7922.34 printed the rendered sheets at A4 size. Each source note and rest has a corresponding engraved glyph. The seven rendered pages and their 453 reference events were fixed before running the browser recognizer. [Font notices](../../../vendor/sheetscan/licenses/tuplet-fonts)

| Score | Instrument | Bars | Events | Coverage |
| --- | --- | ---: | ---: | --- |
| Dancing in the River | Flute | 9 | 34 | 4/4, rests and changes of note value |
| Danza del Venado | Soprano recorder | 16 | 48 | 2/4 and octave treble clef |
| Es wird scho glei dumpa | B-flat clarinet | 21 | 63 | 3/4, pickup, lyrics and written-to-sounding transposition |
| St. Patrick's Day in the Morning | Fife edition | 20 | 96 | 6/8, eighth-note tempo and repeats |
| Charles Wallaces Q.S. | Fife edition | 18 | 114 | 2/4 and triplets |
| Homojanka Kolo | Piccolo edition | 24 | 98 | Key changes, triplets and two pages |

These repertoire families stay together in this independent cohort. The authored regression fixtures exercise the targeted engraving and grace-note controls. The upstream model's training membership for the PDMX scores is unknown. [Authored regression suite](../omr-v1/README.md)

Run `npm run test:omr -- --corpus woodwind` after the [browser test setup](../omr-v1/README.md#run-and-read-the-test-set). The report includes per-score core events, attacks, meter, tempo, notation metadata and engraving, with original musical locations. It saves the PDF.js page rasters, Worker XML, final XML and conversion audit. The totals include every reference event, including scores that fail to produce a comparison.

## First evaluation

SheetScan `v17-source-beams` in Chromium 151.0.7922.34 matched 319 of 453 strict events across the frozen independent scores. These results describe these six complete scores.

| Score | Matched events | First visible differences |
| --- | ---: | --- |
| Dancing in the River | 34/34 | Clef and beam differences appear in the Worker ledger. |
| Danza del Venado | 0/48 | The Worker omits the clef's printed octave 8 and reads each note one octave lower. |
| Es wird scho glei dumpa | 63/63 | Source transposition differs in the notation comparison. |
| St. Patrick's Day in the Morning | 96/96 | Printed structure and metadata differences remain in the score ledger. |
| Charles Wallaces Q.S. | 114/114 | Source metadata and engraving differences remain in the score ledger. |
| Homojanka Kolo | 12/98 | A leading empty measure at each page opening shifts the following measure locations. |

The published baseline retains both output hashes and the exact discrepancy ledger for each case. Differences already present in the first Worker XML can be compared with final annotation. Authoring metadata that lacks an equivalent printed marking remains visible in the metadata comparison.
