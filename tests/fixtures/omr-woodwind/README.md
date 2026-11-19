# Independent woodwind scores

The six complete scores come from the public PDMX archive. The manifest fixes each archive path, score ID, license, exact MusicXML and the PDF rendered from that MusicXML. The selection used the original notation and PDMX's `license_conflict=False` records. It includes a CC0 flute composition by Brandon Moran, traditional recorder and clarinet melodies, and historic fife and piccolo tunes. [PDMX archive and copyright metadata](https://doi.org/10.5281/zenodo.15571083)

The original MusicXML files are the reference answers. Verovio 6.4.1 engraved them in Bravura, Leipzig and Leland using an A4 layout and the scale recorded per score. The two-page score limits each page to two systems. Chromium 151.0.7922.34 printed the rendered sheets at A4 size. Each source note and rest has a corresponding engraved glyph. The seven rendered pages and their 453 reference events were fixed before running the browser recognizer. [Font notices](../../../vendor/sheetscan/licenses/tuplet-fonts)

| Score | Instrument | Bars | Events | Coverage |
| --- | --- | ---: | ---: | --- |
| Dancing in the River | Flute | 9 | 34 | 4/4, rests and changes of note value |
| Danza del Venado | Soprano recorder | 16 | 48 | 2/4 and repeats |
| Es wird scho glei dumpa | B-flat clarinet | 21 | 63 | 3/4, pickup, lyrics and written-to-sounding transposition |
| St. Patrick's Day in the Morning | Fife edition | 20 | 96 | 6/8, dotted tempo and repeats |
| Charles Wallaces Q.S. | Fife edition | 18 | 114 | 2/4 and triplets |
| Homojanka Kolo | Piccolo edition | 24 | 98 | Key changes, triplets and two pages |

These repertoire families stay together in this independent cohort. The authored regression fixtures exercise the targeted engraving and grace-note controls. The upstream model's training membership for the PDMX scores is unknown. [Authored regression suite](../omr-v1/README.md)
