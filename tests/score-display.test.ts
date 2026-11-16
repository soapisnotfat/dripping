// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { scoreEngraving } from '../src/lib/score-display';
import { parseScore, soundingEvents } from '../src/lib/score';
import type { Project } from '../src/lib/types';
const conversion = { engine: 'sheetscan' } as NonNullable<Project['scoreConversion']>;
const note = (type = 'eighth', duration = 2, extra = '') =>
  `<note><pitch><step>C</step><octave>5</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff>${extra}</note>`;
const score = (body: string, beats = 6) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>${beats}</beats><beat-type>8</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>${body}</measure></part></score-partwise>`;
const render = (xml: string) => scoreEngraving({ scoreXml: xml, scoreConversion: conversion });
const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const withoutBeams = (text: string) => {
  const doc = xml(text);
  for (const beam of Array.from(doc.getElementsByTagNameNS('*', 'beam'))) beam.remove();
  return new XMLSerializer().serializeToString(doc);
};
const beams = (text: string) =>
  Array.from(xml(text).getElementsByTagName('beam')).map((b) => [
    b.getAttribute('number'),
    b.textContent,
  ]);
describe('recognized-score display beaming', () => {
  it('leaves native MusicXML and explicit source beams byte-for-byte unchanged', () => {
    const native = score(note().repeat(6));
    expect(scoreEngraving({ scoreXml: native })).toEqual({ xml: native, autoBeam: false });
    const explicit = score(
      note('eighth', 2, '<beam number="1">begin</beam>') +
        note('eighth', 2, '<beam number="1">end</beam>') +
        note().repeat(4),
    );
    expect(render(explicit)).toEqual({ xml: explicit, autoBeam: false });
  });
  it('groups ordinary compound eighth meters into 3/8 beats only in a renderer clone', () => {
    for (const beats of [6, 9, 12]) {
      const original = score(note().repeat(beats), beats),
        project = Object.freeze({ scoreXml: original, scoreConversion: conversion }),
        result = scoreEngraving(project);
      expect(project.scoreXml).toBe(original);
      expect(withoutBeams(result.xml)).toBe(withoutBeams(original));
      expect(
        beams(result.xml)
          .filter((b) => b[0] === '1')
          .map((b) => b[1]),
      ).toEqual(Array.from({ length: beats / 3 }, () => ['begin', 'continue', 'end']).flat());
      expect(soundingEvents(parseScore(result.xml))).toEqual(soundingEvents(parseScore(original)));
    }
  });
  it('preserves rests and grace boundaries rather than joining across them', () => {
    const rest =
        '<note><rest/><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>',
      grace =
        '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>16th</type><staff>1</staff></note>';
    const result = render(score(note() + rest + note() + grace + note().repeat(3))),
      notes = Array.from(xml(result.xml).getElementsByTagName('note'));
    expect(notes[0].getElementsByTagName('beam')).toHaveLength(0);
    expect(notes[1].getElementsByTagName('beam')).toHaveLength(0);
    expect(notes[2].getElementsByTagName('beam')).toHaveLength(0);
    expect(notes[3].getElementsByTagName('beam')).toHaveLength(0);
    expect(beams(result.xml)).toHaveLength(3);
  });
  it('uses correct secondary beam levels and inward partial hooks', () => {
    const result = render(
      score(
        note('eighth', 2) +
          note('16th', 1) +
          note('16th', 1) +
          note('eighth', 2) +
          note('eighth', 3, '<dot/>') +
          note('16th', 1) +
          note('eighth', 2),
      ),
    );
    expect(
      beams(result.xml)
        .filter((b) => b[0] === '2')
        .map((b) => b[1]),
    ).toEqual(['begin', 'end', 'backward hook']);
  });
  it('does not invent compound beams for tuplets, chords, or odd/additive meters', () => {
    const tuplet = note(
        'eighth',
        2,
        '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>',
      ),
      chord = note().replace('<pitch>', '<chord/><pitch>');
    expect(beams(render(score(tuplet.repeat(6))).xml)).toHaveLength(0);
    expect(beams(render(score(note() + chord + note() + note())).xml)).toHaveLength(2);
    const odd = score(note().repeat(5), 5);
    expect(render(odd).xml).toBe(odd);
    const additive = score(note().repeat(6)).replace('<beats>6</beats>', '<beats>3+3</beats>');
    expect(render(additive).xml).toBe(additive);
  });
  it('does not mix voices or staffs and rejects invalid XML', () => {
    const other = note().repeat(6).replaceAll('<voice>1</voice>', '<voice>2</voice>'),
      result = render(score(note().repeat(6) + '<backup><duration>12</duration></backup>' + other));
    expect(beams(result.xml)).toHaveLength(12);
    expect(render('<broken>')).toEqual({ xml: '<broken>', autoBeam: false });
  });
  it('handles 4/4 to 6/8 and back without changing any non-beam XML or playback event', () => {
    const first = score(note().repeat(6)),
      second =
        '<measure number="2"><attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
        note().repeat(8) +
        '</measure>',
      third =
        '<measure number="3"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' +
        note().repeat(6) +
        '</measure>',
      original = first.replace('</part>', second + third + '</part>'),
      result = render(original),
      measures = Array.from(xml(result.xml).getElementsByTagName('measure'));
    expect(measures.map((m) => m.getElementsByTagName('beam').length)).toEqual([6, 0, 6]);
    expect(result.autoBeam).toBe(true);
    expect(withoutBeams(result.xml)).toBe(withoutBeams(original));
    expect(soundingEvents(parseScore(result.xml))).toEqual(soundingEvents(parseScore(original)));
  });
  it('places display beams before lyrics and leaves unknown timing conservative', () => {
    const original = score(note('eighth', 2, '<lyric><text>la</text></lyric>').repeat(6)),
      result = render(original),
      first = xml(result.xml).getElementsByTagName('note')[0];
    expect(
      Array.from(first.children)
        .map((c) => c.localName)
        .slice(-2),
    ).toEqual(['beam', 'lyric']);
    expect(withoutBeams(result.xml)).toBe(withoutBeams(original));
    const missing = score(note().repeat(6)).replace('<duration>2</duration>', '');
    expect(beams(render(missing).xml)).toHaveLength(0);
  });
});
