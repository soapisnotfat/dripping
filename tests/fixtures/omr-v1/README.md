# OMR regression fixtures v1

These are disclosed, authored tests. The manifest freezes the PDF, MusicXML and crop bytes. The musical answers come from the authored MusicXML and were fixed before conversion. The suite includes ten complete exercises and two crops.

| Input | Reference checks |
| --- | --- |
| `grace-slur.pdf` | 16 timed events and one grace note. In measure 2, a natural F grace note slurs into a natural F principal note, which has its own attack. The key signature, accidental carry and bar reset are part of the reference. |
| `grace-slur-upper.pdf` | The same natural carry exercise in Bravura with the grace-to-principal slur above the down-stem pair. The principal F requires an independent attack. |
| `grace-tie.pdf` | The same natural carry exercise in Leipzig with an explicitly authored grace-to-principal tie. The principal F has a tie stop and no new attack. |
| `tie-controls.pdf` | 15 timed events and two ordered grace notes. A G tie crosses the first barline. The E–D slur in measure 2 and the two-grace slur into E in measure 3 are ordinary slurs. Measure 4 includes a quarter rest. |
| `tie-within-bar.pdf` | 17 timed events. A D tie in measure 1 and a G tie in measure 3 are separate from the untied repeated D in measure 2. This separately tests ties within a bar after the cross-bar control exposed a baseline omission. |
| `ordinary-curves.pdf` | 48 timed notes. Five genuine ties merge their second notes into the first attack. Four same-pitch slurs keep both attacks, including a pair with opposing stems. Three plain repetitions exercise the case without a curve. |
| `quintuplet-score.pdf` | 18 timed events. Measure 2 has five eighths in the time of four, each lasting 2/5 quarter notes, then a quarter rest. A genuine 3/8 begins in measure 3. The first and second measures supply ordinary and cross-beat explicit beam groups. |
| `beam-controls.pdf` | 28 timed events and two grace notes. The 26 explicit beam elements include mixed primary and secondary groups, hooks in both directions, a beam over an eighth rest, and two beamed grace notes. A separated run of five flagged eighth notes provides a negative control. |
| `treble-octave.pdf` | 24 timed events across three systems. An octave treble clef raises the written pitches on the first two systems. The final system starts with a plain treble clef. |
| `opening-repeats.pdf` | 16 timed events in four measures. Both pages begin with a forward repeat. The reference checks their position, the initial meter and the number of musical measures. |
| `tuplet-fragment.png` and `tuplet-no-digit.png` | The 150 × 150 Bravura crop contains a fragmented 5 above a beam. The control erases `[51, 55, 69, 77)` and restores staff row 73. Both variants stay in the same source family. |

The grace exercise and its variants come from `grace-natural-bare-carry` in the pinned SheetScan generator. The other scores were authored for this test set. They were engraved with Verovio 6.4.1 (`6.4.1-fbe8f46`) on A4 pages with no headers or footers. `grace-slur`, `grace-tie` and `ordinary-curves` use Leipzig. `opening-repeats` uses Leland and an explicit page break. The other exercises use Bravura. Chromium 151.0.7922.34 printed each SVG at A4 size. The checked-in PDF bytes are the reproducible inputs. [Generator source](https://github.com/soapisnotfat/sheetscan/blob/33dd06488cc386b8ebfae929e5ea00e5a61efe74/bench/natural_binding_cases.py) [Font notices](../../../vendor/sheetscan/licenses/tuplet-fonts)

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

The original observed baseline uses Dripping `8ca941a` and its SheetScan `v15-notation-metadata` pin on Chromium 151.0.7922.34. The baseline file retains those source, model, runtime, raster and XML receipts. Its per-location discrepancy lists are the current allowances.

| Case | Strict timed events | Observed differences |
| --- | ---: | --- |
| Same-pitch grace slur | 15/16 | In measure 2 the Worker writes a tie at the grace and principal F, loses the slur and suppresses the principal attack. The final annotation carries the error through. |
| Above-stem grace slur | 15/16 | The v15 Worker likewise writes a tie and suppresses the principal F attack. |
| Genuine grace tie | 16/16 | Both tie endpoints and all 15 independent attacks match. |
| Across-bar tie and slurs | 13/15 | Both endpoints of the real G tie at the first barline are missing. The two ordinary slurs and both ordered graces match. |
| Within-bar ties and repeats | 15/17 | The D tie in measure 1 is missing. The G tie in measure 3 and the independent strikes of D in measure 2 match. |
| Ordinary ties, slurs and repetitions | 40/48 | V18 writes all four same-pitch slurs as ties and suppresses four independent attacks. |
| Quintuplet and meter change | 18/18 | The five tuplet notes and both meters match. Explicit beam tags and the expected neutral-key declaration are absent. |
| Mixed source beams | 28/28 | V15 recognizes the timed events and both graces. No explicit beam tags were exported. |
| Upward octave clef | 8/24 | V17 omits both printed octave digits. The notes on the first two systems are an octave low. |
| Page-opening repeats | 1/16 | V17 adds a header-only measure before each page's opening repeat and shifts the original bar locations. |
| Fragmented 5 and erased control | Both exact | The positive crop returns the expected 5 at its marked location. The control returns no marks. |

The `v16-source-grace-slurs` pin reads both grace slurs at 16/16 with all their attacks. All three grace exercises now require exact matches.

The `v17-source-beams` pin requires exact matches for all 43 explicit beam elements across the two beam exercises. The previously allowed beam omissions were removed. The neutral-key discrepancies in the quintuplet score remain in the baseline.

The `v18-source-headers` pin requires exact matches for both header exercises. The octave exercise retains 24 timed events and the return to ordinary treble. The repeat exercise retains all 16 timed events in the original four bars.

The `v19-source-curves` pin recovers the cross-bar G tie and the within-bar D tie. Both original exercises now require exact matches. The ordinary-curve exercise requires all 48 timed notes, all four written slurs and all 43 independent attacks. The conversion audit includes the source box and notehead coordinates for every curve correction.

The [independent woodwind corpus](../omr-woodwind/README.md) records a separate whole-score evaluation. The original 137/160/267-event scores and paired reference answers would be needed to qualify the private-score mismatches in #33.
