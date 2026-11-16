// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import emitted from './fixtures/pdf-sax-metadata.json';
import { parseScore } from '../src/lib/score';
import { scoreEngraving } from '../src/lib/score-display';
import { addFiles } from '../src/lib/project';
import { newProject } from '../src/lib/storage';

const sounding = new Map([
  ['soprano-header', [70, 72, 74]],
  ['alto-header', [63, 65, 67]],
  ['tenor-header', [58, 60, 62]],
  ['baritone-header', [51, 53, 55]],
  ['tenor-explicit-0', [72, 74, 76]],
  ['baritone-explicit-0', [72, 74, 76]],
]);

it.each(emitted.cases)(
  'plays emitted $id at sounding pitch without rewriting written notes',
  (fixture) => {
    const score = parseScore(fixture.musicxml);
    expect(score.events.map((event) => event.writtenMidi)).toEqual([72, 74, 76]);
    expect(score.events.map((event) => event.midi)).toEqual(sounding.get(fixture.id));
    const engraving = scoreEngraving({
      scoreXml: fixture.musicxml,
      scoreConversion: { engine: 'sheetscan' } as Parameters<
        typeof scoreEngraving
      >[0]['scoreConversion'],
    });
    const displayed = parseScore(engraving.xml);
    expect(
      displayed.events.map((event) => [event.writtenMidi, event.midi, event.q, event.duration]),
    ).toEqual(
      score.events.map((event) => [event.writtenMidi, event.midi, event.q, event.duration]),
    );
    expect(fixture.musicxml.match(/<transpose>/g)).toHaveLength(1);
  },
);

it.each(emitted.cases.filter((fixture) => fixture.id.endsWith('explicit-0')))(
  'preserves native MusicXML import $id with explicit concert pitch',
  async (fixture) => {
    const project = await addFiles(
      newProject(fixture.id),
      [
        {
          file: new File([fixture.musicxml], `${fixture.id}.musicxml`, { type: 'application/xml' }),
          role: 'score',
        },
      ],
      () => {},
    );
    expect(project.scoreXml).toBe(fixture.musicxml);
    expect(project.score!.events.map((event) => event.midi)).toEqual([72, 74, 76]);
    expect(scoreEngraving(project).xml).toBe(fixture.musicxml);
  },
);
