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

The existing positive crop and its negative transformation come from SheetScan's source geometry regression. The crop is from an authored piano development page and exercises the glyph reader in the same area of interest. The clean flute quintuplet is an end-to-end control with its own reference. [Crop provenance and geometry](https://github.com/soapisnotfat/sheetscan/tree/33dd06488cc386b8ebfae929e5ea00e5a61efe74/bench/fixtures)

The original score and crop content is CC0-1.0. Font software retains its license. See the [Bravura notice](../../../vendor/sheetscan/Bravura-LICENSE.txt), [Leipzig notice](../../../vendor/sheetscan/Leipzig-LICENSE.txt) and [embedded Liberation Serif notice](../pdf-metadata/Liberation-FONT-NOTICE.txt).

## Run and read the test set

Set up the test tools in the repository root using Python 3.12 and the project's supported Node.js version.

```sh
npm ci
python3 -m venv .cache/omr-venv
. .cache/omr-venv/bin/activate
python -m pip install -r tests/omr/requirements.txt
python -m playwright install --only-shell chromium
npm run test:omr
```

On a fresh Linux system, Playwright's `install --with-deps --only-shell chromium` also installs its browser system libraries. The command uses the current repository pin, verifies the SDK and prepares its local runtime and model assets. The first setup needs network access for those dependencies. Subsequent runs can reuse the verified cache. Browser conversion serves the real SDK locally without a recognition service. To test the shared-memory bridge, run `npm run test:omr -- --shared`.

The command writes a fresh `test-results/omr/run-*/report.json`. Each PDF includes the page PNGs actually given to the recognizer, initial Worker XML, any repaired rest-count stage, final XML and conversion audit. The first Worker XML already includes Python pipeline corrections. It is the earliest stage exposed by the production SDK. The crop probe runs the exact tuplet reader files embedded in that SDK worker, with the pinned Pyodide and OpenCV runtime. It scores the detected digit and bounding box. The full-score PDF separately exercises recognition and rhythm correction end to end.

The evaluator reports timed notes and rests, attacks, grace order, tie and slur semantics, written locations, meter, explicit beam and tuplet marks, and other supported notation fields. It uses exact rational offsets and the existing global per-part voice mapping. New discrepancies are compared by case, category, musical location, value and count. A new wrong note cannot be canceled out by fixing a different one. Missing conversions or missing results fail the run. The gate uses final XML and crop results. Earlier XML remains available to trace errors.

The `OMR regression` workflow runs this command for relevant changes and uploads the report and stage files. It compares existing case definitions and known discrepancies against the PR base. A PR can add a case or remove a resolved discrepancy from the allowance in `baseline.json`. Changing an existing reference or allowing another discrepancy fails that comparison.

## Observed baseline

The baseline uses Dripping `8ca941a` and its SheetScan `v15-notation-metadata` pin on Chromium 151.0.7922.34. The baseline file records source, model, runtime, raster and XML hashes with the per-location discrepancy list.

| Case | Strict timed events | Observed differences |
| --- | ---: | --- |
| Same-pitch grace slur | 15/16 | In measure 2 the Worker writes a tie at the grace and principal F, loses the slur and suppresses the principal attack. The final annotation carries the error through. |
| Across-bar tie and slurs | 13/15 | Both endpoints of the real G tie at the first barline are missing. The two ordinary slurs and both ordered graces match. |
| Within-bar ties and repeats | 15/17 | The D tie in measure 1 is missing. The G tie in measure 3 and the independent strikes of D in measure 2 match. |
| Quintuplet and meter change | 18/18 | The five tuplet notes and both meters match. Explicit beam tags and the expected neutral-key declaration are absent. |
| Fragmented 5 and erased control | Both exact | The positive crop returns the expected 5 at its marked location. The control returns no marks. |

These receipts establish regression coverage on the checked-in exercises. The original 137/160/267-event score files and paired reference answers remain unavailable in the public checkout. The independent whole-score corpus and the four original compound-score mismatches are still outstanding in #30 and #33.
