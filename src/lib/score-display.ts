import type { Project } from './types';

const children = (parent: Element, name: string) =>
  Array.from(parent.children).filter((node) => node.localName === name);
const first = (parent: Element, name: string) => children(parent, name)[0];
const value = (parent: Element, name: string) => first(parent, name)?.textContent?.trim() || '';
const levels: Record<string, number> = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4 };
type Entry = {
  note: Element;
  onset: number;
  duration: number;
  level: number;
  eligible: boolean;
  beat: number;
};
const EPS = 1e-7;

/** Display fallback only: source XML and the playback score remain untouched. */
export function scoreEngraving(project: Pick<Project, 'scoreXml' | 'scoreConversion'>): {
  xml: string;
  autoBeam: boolean;
} {
  const original = project.scoreXml || '';
  if (project.scoreConversion?.engine !== 'sheetscan' || !original)
    return { xml: original, autoBeam: false };
  const doc = new DOMParser().parseFromString(original, 'application/xml');
  if (
    doc.getElementsByTagName('parsererror').length ||
    doc.getElementsByTagNameNS('*', 'beam').length
  )
    return { xml: original, autoBeam: false };
  let changed = false;
  const mark = (entry: Entry, number: number, text: string) => {
    const beam = entry.note.namespaceURI
      ? doc.createElementNS(
          entry.note.namespaceURI,
          entry.note.prefix ? entry.note.prefix + ':beam' : 'beam',
        )
      : doc.createElement('beam');
    beam.setAttribute('number', String(number));
    beam.textContent = text;
    const following = Array.from(entry.note.children).find((node) =>
      ['notations', 'lyric', 'play', 'listen'].includes(node.localName),
    );
    entry.note.insertBefore(beam, following || null);
    changed = true;
  };
  const connect = (run: Entry[]) => {
    if (run.length < 2) return;
    for (let number = 1; number <= Math.max(...run.map((entry) => entry.level)); number++) {
      for (let index = 0; index < run.length;) {
        if (run[index].level < number) {
          index++;
          continue;
        }
        const begin = index;
        while (index < run.length && run[index].level >= number) index++;
        const end = index - 1;
        if (begin === end) {
          const parentUnit = 4 / 2 ** (number + 1),
            within = ((run[begin].onset % parentUnit) + parentUnit) % parentUnit;
          const forward = begin === 0 || (end !== run.length - 1 && within < parentUnit / 2 - EPS);
          mark(run[begin], number, forward ? 'forward hook' : 'backward hook');
        } else
          for (let at = begin; at <= end; at++)
            mark(run[at], number, at === begin ? 'begin' : at === end ? 'end' : 'continue');
      }
    }
  };
  for (const part of Array.from(doc.getElementsByTagNameNS('*', 'part'))) {
    let divisions = 0,
      compound = false;
    for (const measure of children(part, 'measure')) {
      let cursor = 0,
        lastOnset = 0,
        notesStarted = false,
        meterChangedInside = false,
        unreliablePosition = false;
      const voices = new Map<string, Entry[]>(),
        lastByVoice = new Map<string, Entry>();
      for (const item of Array.from(measure.children)) {
        if (item.localName === 'attributes') {
          const next = Number(value(item, 'divisions'));
          if (next > 0) divisions = next;
          const time = first(item, 'time');
          if (time) {
            if (notesStarted) meterChangedInside = true;
            const beats = children(time, 'beats'),
              types = children(time, 'beat-type');
            compound =
              beats.length === 1 &&
              types.length === 1 &&
              /^(6|9|12)$/.test(beats[0].textContent?.trim() || '') &&
              types[0].textContent?.trim() === '8';
          }
          continue;
        }
        if (item.localName === 'backup' || item.localName === 'forward') {
          const duration = Number(value(item, 'duration')) / divisions;
          if (Number.isFinite(duration))
            cursor += (item.localName === 'backup' ? -1 : 1) * duration;
          else unreliablePosition = true;
          continue;
        }
        if (item.localName !== 'note') continue;
        notesStarted = true;
        const grace = !!first(item, 'grace'),
          chord = !!first(item, 'chord'),
          duration = Number(value(item, 'duration')) / divisions;
        if (!grace && (!Number.isFinite(duration) || duration <= 0)) unreliablePosition = true;
        const onset = chord ? lastOnset : cursor;
        if (!chord) lastOnset = onset;
        if (!grace && !chord && Number.isFinite(duration)) cursor += duration;
        const key = (value(item, 'voice') || '1') + ':' + (value(item, 'staff') || '1'),
          level = levels[value(item, 'type')] || 0,
          dots = children(item, 'dot').length;
        const expected = level ? (4 / 2 ** (level + 2)) * (2 - 2 ** -dots) : 0,
          beat = Math.floor((onset + EPS) / 1.5);
        const eligible =
          !grace &&
          !chord &&
          !first(item, 'rest') &&
          !first(item, 'time-modification') &&
          !item.getElementsByTagNameNS('*', 'tuplet').length &&
          level > 0 &&
          Number.isFinite(duration) &&
          duration > 0 &&
          Math.abs(duration - expected) < EPS &&
          onset >= -EPS &&
          onset + duration <= (beat + 1) * 1.5 + EPS;
        const entry = { note: item, onset, duration, level, eligible, beat };
        if (chord) {
          const prior = lastByVoice.get(key);
          if (prior) prior.eligible = false;
        } else lastByVoice.set(key, entry);
        const entries = voices.get(key) || [];
        entries.push(entry);
        voices.set(key, entries);
      }
      // OSMD 2.3.1 splits automatic groups at every denominator beat, so plain
      // compound eighth-note meters need conventional 3/8 beams in this clone.
      if (!compound || meterChangedInside || unreliablePosition) continue;
      for (const entries of voices.values()) {
        let run: Entry[] = [];
        const flush = () => {
          connect(run);
          run = [];
        };
        for (const entry of entries) {
          if (!entry.eligible) {
            flush();
            continue;
          }
          const previous = run.at(-1);
          if (
            previous &&
            (entry.beat !== previous.beat ||
              Math.abs(entry.onset - previous.onset - previous.duration) > EPS)
          )
            flush();
          run.push(entry);
        }
        flush();
      }
    }
  }
  return { xml: changed ? new XMLSerializer().serializeToString(doc) : original, autoBeam: true };
}
