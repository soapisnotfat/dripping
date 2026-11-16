// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseScore, soundingEvents, readScoreFile } from '../src/lib/score';
import { tempoMap, qToSeconds, secondsToQ, beatGrid, validateAnchors } from '../src/lib/time';
import { zipSync, strToU8 } from 'fflate';
import { demoXml } from '../src/lib/demo';

const wrap = (measures: string) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const attrs =
  '<attributes><divisions>6</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (duration: number, extra = '') =>
  `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`;
describe('MusicXML musical structure', () => {
  it('retains multi-measure rests and meter changes without shifting following measures', () => {
    const score = parseScore(demoXml());
    expect(score.measures).toHaveLength(16);
    expect(score.totalQ).toBe(62);
    expect(score.measures[4].notes[0].midi).toBe(null);
    expect(score.route[9].q).toBe(34);
    const grid = beatGrid(score);
    expect(grid.filter((q) => q >= 32 && q < 34)).toEqual([32, 33]);
    expect(qToSeconds(34, tempoMap(score))).toBeCloseTo(21.25);
  });
  it('handles a pickup, tuplets, grace notes, ties, backup, and chord simultaneity', () => {
    const score = parseScore(
      wrap(
        `<measure number="0" implicit="yes">${attrs}${note(6, '<tie type="start"/>')}</measure><measure number="1">${note(6, '<tie type="stop"/>')}<note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>${note(2)}${note(2)}${note(2)}${note(12)}<backup><duration>24</duration></backup>${note(24, '<voice>2</voice>')}</measure>`,
      ),
    );
    expect(score.route[1].q).toBe(1);
    expect(score.totalQ).toBe(5);
    expect(score.events.find((e) => e.grace)?.duration).toBe(0);
    expect(score.events.filter((e) => e.q === 1 && e.duration > 0)).toHaveLength(2);
    const sounding = soundingEvents(score);
    expect(sounding[0].duration).toBe(2);
    expect(sounding.filter((e) => e.grace)).toHaveLength(0);
  });
  it('expands repeated measures and first/second endings', () => {
    const score = parseScore(
      wrap(
        `<measure number="1">${attrs}<barline location="left"><repeat direction="forward"/></barline>${note(24)}</measure><measure number="2"><barline location="left"><ending number="1" type="start"/></barline>${note(24)}<barline><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure><measure number="3"><barline location="left"><ending number="2" type="start"/></barline>${note(24)}<barline><ending number="2" type="stop"/></barline></measure>`,
      ),
    );
    expect(score.route.map((m) => m.number)).toEqual(['1', '2', '1', '3']);
    expect(score.totalQ).toBe(16);
  });
  it('keeps written and sounding pitch distinct for transposing instruments', () => {
    const score = parseScore(
      wrap(
        `<measure>${attrs}<attributes><transpose><chromatic>-9</chromatic></transpose></attributes>${note(24)}</measure>`,
      ),
    );
    expect(score.events[0].writtenMidi).toBe(60);
    expect(score.events[0].midi).toBe(51);
  });
  it('validates malformed XML and disallows external entities', () => {
    expect(() => parseScore('<broken>')).toThrow();
    expect(() =>
      parseScore('<!DOCTYPE test [<!ENTITY x SYSTEM "file:///secret">]><score-partwise/>'),
    ).toThrow();
  });
  it('reads the rootfile declared by MXL container rather than the largest XML file', async () => {
    const zipped = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      'score.musicxml': strToU8(demoXml()),
      'irrelevant.xml': strToU8('<data>' + 'x'.repeat(30000) + '</data>'),
    });
    const blob = { arrayBuffer: async () => zipped.buffer } as Blob;
    expect(parseScore(await readScoreFile(blob)).title).toBe('Morning Drops');
  });
});
describe('time maps', () => {
  it('maps invertibly through meter-independent tempo segments and offset', () => {
    const map = [
      { q: 0, seconds: 0.37 },
      { q: 8, seconds: 4.37 },
      { q: 10, seconds: 6.37 },
      { q: 18, seconds: 10.37 },
    ];
    for (const q of [-1, 0, 0.25, 8, 9, 10, 15, 20])
      expect(secondsToQ(qToSeconds(q, map), map)).toBeCloseTo(q, 9);
    expect(() =>
      validateAnchors([
        { q: 0, seconds: 0 },
        { q: 4, seconds: 0 },
      ]),
    ).toThrow();
  });
});
