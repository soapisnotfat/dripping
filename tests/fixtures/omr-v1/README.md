# OMR regression fixtures v1

These are disclosed, authored tests. The manifest freezes the PDF, MusicXML and crop bytes. The musical answers come from the authored MusicXML and were fixed before conversion. The rendered PDFs were checked for the notes, ties, slurs, printed 5, and change of meter. V1 contains four complete four-measure exercises and two crops.

| Input | Reference checks |
| --- | --- |
| `grace-slur.pdf` | 16 timed events and one grace note. In measure 2, a natural F grace note slurs into a natural F principal note, which has its own attack. The key signature, accidental carry and bar reset are part of the reference. |
| `tie-controls.pdf` | 15 timed events and two ordered grace notes. A G tie crosses the first barline. The E–D slur in measure 2 and the two-grace slur into E in measure 3 are ordinary slurs. Measure 4 includes a quarter rest. |
| `tie-within-bar.pdf` | 17 timed events. A D tie in measure 1 and a G tie in measure 3 are separate from the untied repeated D in measure 2. This separately tests ties within a bar after the cross-bar control exposed a baseline omission. |
| `quintuplet-score.pdf` | 18 timed events. Measure 2 has five eighths in the time of four, each lasting 2/5 quarter notes, then a quarter rest. A genuine 3/8 begins in measure 3. The first and second measures supply ordinary and cross-beat explicit beam groups. |
| `tuplet-fragment.png` and `tuplet-no-digit.png` | The 150 × 150 Bravura crop contains a fragmented 5 above a beam. The control erases `[51, 55, 69, 77)` and restores staff row 73. Both variants stay in the same source family. |

The grace score is the `grace-natural-bare-carry` case from the pinned SheetScan generator. The other scores were authored for this test set. They were engraved with Verovio 6.4.1 (`6.4.1-fbe8f46`), A4 canvas 2100 × 2970, scale 45, automatic breaks, fixed page height and no header or footer. `grace-slur` uses Leipzig and the others use Bravura. Chromium 151.0.7922.34 printed each SVG at A4 size. The checked-in PDF bytes are the reproducible inputs. [Generator source](https://github.com/soapisnotfat/sheetscan/blob/33dd06488cc386b8ebfae929e5ea00e5a61efe74/bench/natural_binding_cases.py)

The existing positive crop and its negative transformation come from SheetScan's source geometry regression. The crop is from an authored piano development page and exercises the glyph reader in the same area of interest. The clean flute quintuplet is an end-to-end control with its own reference. These fixtures do not recover the original mono 155/160 full-score run. [Crop provenance and geometry](https://github.com/soapisnotfat/sheetscan/tree/33dd06488cc386b8ebfae929e5ea00e5a61efe74/bench/fixtures)

The original score and crop content is CC0-1.0. Font software retains its license. See the [Bravura notice](../../../vendor/sheetscan/Bravura-LICENSE.txt), [Leipzig notice](../../../vendor/sheetscan/Leipzig-LICENSE.txt) and [embedded Liberation Serif notice](../pdf-metadata/Liberation-FONT-NOTICE.txt).
