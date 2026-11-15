# Dripping

## Input contract

Import a prepared MusicXML (`.musicxml`, `.xml`, `.mxl`) score, backing audio, and demonstration audio. PDF conversion and optical music recognition are outside this app. A score-only project and an audio-only project remain useful intermediate states.

## First usable release

- A desktop and tablet workspace, with interactive sheet music above a separately scrollable audio timeline.
- Click notes, select passages, loop, change practice speed without changing pitch, and follow the current score position.
- Interpret notes, rests, meter changes, ties, tuplets, grace notes and repeats from the score. Never treat PDF widths or a fixed four-beat grid as music time.
- Analyze audio against score content, retain independent track alignments, and clearly distinguish candidate alignment from accepted alignment. Provide local anchor correction where needed.
- Record only the selected audio input while playing the backing. Preserve every take, enable non-destructive edits, and export aligned WAV stems or a mix.
- Keep original assets and projects on the device. Export and restore a portable `.drippingproj` backup. Show saving failures and recover interrupted recording chunks.
- Support Chinese and English, keyboard interaction, and touch equivalents for context-menu actions.

## Product boundaries

No MIDI input, full DAW framework, PDF recognition, account, server or cloud upload is required. Local browser storage is not a backup. USB device/channel support, recording latency and background suspension depend on the browser and hardware and must be tested on the target device.

## Visual direction

Paper theme: warm neutral surfaces, readable notation, restrained green and gold accents, a drop-shaped musical mark, and a clear shared transport. A dark variant follows the device theme. Score and audio remain separate sections; editing one must not steal the other's browsing position.

## Acceptance

Validate the full import → score render → audio alignment → playback → take capture → edit → WAV export → project backup/restore path. Use synthetic, inspectable fixtures in the repository; keep personal scores, recordings and copyrighted media outside Git. Separate automated checks from physical USB/iPad checks.
