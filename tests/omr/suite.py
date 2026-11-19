"""Frozen answers and a no-new-discrepancies gate for the OMR test set."""

from collections import Counter
from fractions import Fraction
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET

TOOLS = Path(__file__).resolve().parent
FIXTURES = TOOLS.parent / 'fixtures' / 'omr-v1'
sys.path.insert(0, str(TOOLS / 'vendor'))
import practice_metrics as core
import qualification_v1 as qualification


def digest(data):
    return sha256(data).hexdigest()


def checked_file(directory, record):
    name = record['file']
    if Path(name).name != name or name in ('', '.', '..'):
        raise ValueError(f'Invalid frozen file name: {name}')
    path = directory / name
    if digest(path.read_bytes()) != record['sha256']:
        raise ValueError(f'Frozen file changed: {path}')
    return path


def load_manifest(directory=FIXTURES):
    raw = (directory / 'manifest.json').read_bytes()
    manifest = json.loads(raw)
    if manifest['version'] != 1:
        raise ValueError('Unsupported OMR test set version')
    if set(manifest['evaluators']) != {'practice_metrics.py', 'qualification_v1.py'}:
        raise ValueError('Incomplete pinned evaluator list')
    for name, checksum in manifest['evaluators'].items():
        checked_file(TOOLS / 'vendor', {'file': name, 'sha256': checksum})

    cases = {}
    for case in manifest['cases']:
        identifier = case['id']
        if not re.fullmatch('[a-z0-9-]+', identifier) or identifier in cases:
            raise ValueError(f'Invalid or repeated case ID: {identifier}')
        cases[identifier] = case
        source = checked_file(directory, case['source'])
        if case['kind'] == 'pdf':
            if not source.read_bytes().startswith(b'%PDF-'):
                raise ValueError(f'{identifier}: expected a PDF')
            truth = ET.parse(checked_file(directory, case['truth'])).getroot()
            verify_reference(truth, case['inventory'], identifier)
        elif case['kind'] == 'tuplet-crop':
            if not source.read_bytes().startswith(b'\x89PNG\r\n\x1a\n') or not case['staffBoxes']:
                raise ValueError(f'{identifier}: expected a PNG and staff coordinates')
        else:
            raise ValueError(f'{identifier}: unknown case kind')
    if not cases:
        raise ValueError('No cases in the OMR test set')
    return cases, digest(raw)


def json_key(value):
    # MusicXML locations use exact rational quarter-note units.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)


def difference(category, truth, reading, describe):
    rows = []
    for operation, remaining in [('missing', truth - reading), ('extra', reading - truth)]:
        for signature, count in sorted(remaining.items(), key=lambda item: json_key(item[0])):
            rows.append(dict(category=category, operation=operation, item=describe(signature), count=count))
    return rows


def diagnostics(root, voices):
    """Compare grace order, slur endpoints and engraved ties at written locations.

    Normalize a slur's number by pairing its endpoints. XML numbers can change
    without moving a span. Playback ties are evaluated separately by the core.
    """
    result = {key: Counter() for key in ('grace-order', 'grace-playback-tie', 'slur', 'tied', 'tuplet-marker')}
    for part_index, part in enumerate(root.findall('part'), 1):
        divisions = 1
        active_slurs = {}
        for measure_index, measure in enumerate(part.findall('measure'), 1):
            cursor = previous = Fraction()
            grace_orders = Counter()
            for item in measure:
                if item.tag == 'attributes':
                    divisions = int(item.findtext('divisions', str(divisions)))
                elif item.tag in ('backup', 'forward'):
                    duration = Fraction(item.findtext('duration')) / divisions
                    cursor += duration if item.tag == 'forward' else -duration
                elif item.tag == 'note':
                    chord = item.find('chord') is not None
                    grace = item.find('grace') is not None
                    onset = previous if chord else cursor
                    if not chord and not grace:
                        previous = cursor
                        cursor += Fraction(item.findtext('duration', '0')) / divisions
                    if item.get('print-object') == 'no':
                        continue

                    voice = item.findtext('voice', '1')
                    voice = voices.get(part_index, {}).get(voice, voice)
                    staff = item.findtext('staff', '1')
                    pitch = item.find('pitch')
                    written = None if pitch is None else (
                        pitch.findtext('step'), str(Fraction(pitch.findtext('alter', '0'))),
                        pitch.findtext('octave'),
                    )
                    order = None
                    if grace:
                        group = (staff, voice, onset)
                        grace_orders[group] += 1
                        order = grace_orders[group]
                    anchor = (part_index, measure_index, staff, voice, str(onset), order, written)
                    if grace:
                        result['grace-order'][anchor] += 1
                        for tie in item.findall('tie'):
                            result['grace-playback-tie'][(anchor, tie.get('type'))] += 1
                    for tie in item.findall('notations/tied'):
                        result['tied'][(anchor, tie.get('type'))] += 1
                    for tuplet in item.findall('notations/tuplet'):
                        result['tuplet-marker'][(anchor, tuplet.get('type'))] += 1
                    for slur in item.findall('notations/slur'):
                        kind = slur.get('type')
                        key = (staff, voice, slur.get('number', '1'))
                        if kind == 'start':
                            if key in active_slurs:
                                result['slur'][('overlapping-start', active_slurs[key], anchor)] += 1
                            active_slurs[key] = anchor
                        elif kind == 'stop':
                            start = active_slurs.pop(key, None)
                            result['slur'][('span' if start else 'orphan-stop', start, anchor)] += 1
                        elif kind != 'continue' or key not in active_slurs:
                            result['slur'][('invalid-endpoint', None, anchor)] += 1
        for start in active_slurs.values():
            result['slur'][('unclosed-start', start, None)] += 1
    return result


def verify_reference(truth, expected, identifier):
    frozen = core.read(truth)
    spans = diagnostics(truth, {})['slur']
    inventory = {
        'measures': sum(frozen['bars']),
        'events': frozen['events'].total(),
        'graces': frozen['graces'].total(),
        'slurs': spans.total(),
        'ties': len(truth.findall('part/measure/note/tie')),
    }
    if any(kind != 'span' for kind, _, _ in spans) or not inventory['events'] or inventory != expected:
        raise ValueError(f'{identifier}: reference inventory changed: {inventory}')


def event_description(signature, names):
    return {name: value for name, value in zip(names, signature, strict=True)}


NOTE_ANCHOR = ('part', 'measure', 'staff', 'voice', 'onset', 'graceOrder', 'pitch')


def anchor_description(anchor):
    return event_description(anchor, NOTE_ANCHOR) if anchor is not None else None


def compare_score(truth, reading):
    report = core.compare(truth, reading)
    if not report['voiceNormalization']['supported']:
        raise ValueError('Unsupported global voice correspondence')
    left, right, _ = core._voice_normalized(core.read(truth), core.read(reading))
    ledger = []
    for category, field, suffix in [
        ('core-event', 'events', ('duration', 'kind', 'pitch', 'playbackTies', 'tupletRatio')),
        ('grace', 'graces', ('kind', 'pitch')),
        ('attack', 'attacks', ('pitch',)),
    ]:
        def describe(row):
            part, measure, *rest = row
            return event_description((part + 1, measure + 1, *rest),
                                     ('part', 'measure', 'voice', 'staff', 'onset', *suffix))
        ledger.extend(difference(category, left[field], right[field], describe))

    def left_locations(score):
        return Counter((part + 1, measure + 1, value) for (part, measure), value in score['meters'].items())

    ledger.extend(difference('meter', left_locations(left), left_locations(right),
                             lambda row: event_description(row, ('part', 'measure', 'meter'))))
    for field, names in [('tempos', ('part', 'measure', 'onset', 'quarterBpm')),
                         ('form', ('part', 'measure', 'side', 'kind', 'type', 'value'))]:
        ledger.extend(difference(field, left[field], right[field],
                                 lambda row: event_description((row[0] + 1, row[1] + 1, *row[2:]), names)))

    notation = qualification.compare(truth, reading)
    if not notation['supported'] or not notation['truthHasKnownKeyAndClef']:
        raise ValueError(f'Unsupported notation in score comparison: {notation["issues"]}')
    for category, values in notation['headers']['categories'].items():
        for row in values['differences']:
            part, measure, staff, onset = row['location']
            ledger.append(dict(category=category, operation='different', count=1, item=dict(
                part=part + 1, measure=measure + 1, staff=staff, onset=onset,
                expected=row['truth'], observed=row['reading'],
            )))
    for category in ('navigation', 'octaveShifts'):
        left_items = Counter(dict(notation[category]['truth']))
        right_items = Counter(dict(notation[category]['reading']))
        ledger.extend(difference(category, left_items, right_items, lambda row: row))

    voices = {}
    for row in report['voiceNormalization']['parts']:
        mapping = {pair['reading']: pair['truth'] for pair in row['pairs']}
        mapping.update({label: f'unmatched-reading-voice:{label}' for label in row['unmatchedReadingLabels']})
        voices[row['partIndex']] = mapping
    truth_beams = qualification.read(truth)['beams']
    reading_beams = Counter()
    for key, count in qualification.read(reading)['beams'].items():
        part, measure, voice, *rest = key
        reading_beams[(part, measure, voices.get(part + 1, {}).get(voice, voice), *rest)] += count
    ledger.extend(difference('beam', truth_beams, reading_beams,
                             lambda row: event_description((row[0] + 1, row[1] + 1, *row[2:]),
                                                           ('part', 'measure', 'voice', 'staff', 'onset', 'duration', 'pitch', 'number', 'value'))))

    truth_marks, actual_marks = diagnostics(truth, {}), diagnostics(reading, voices)
    for category, counter in truth_marks.items():
        if category == 'grace-order':
            describe = anchor_description
        elif category == 'slur':
            def describe(row):
                return dict(kind=row[0], start=anchor_description(row[1]), end=anchor_description(row[2]))
        else:
            def describe(row):
                return {**anchor_description(row[0]), 'type': row[1]}
        ledger.extend(difference(category, counter, actual_marks[category], describe))
    return dict(core=report, notation=notation, discrepancies=sorted(ledger, key=json_key))


def compare_marks(expected, observed):
    def signatures(marks):
        return Counter((mark['staff'], mark['number'], tuple(mark['box'])) for mark in marks)

    return difference('printed-tuplet', signatures(expected), signatures(observed),
                      lambda row: event_description(row, ('staff', 'number', 'box')))


def compare_baseline(current, known):
    """Require each remaining discrepancy to be present at its original location."""
    def counts(rows):
        result = Counter()
        for row in rows:
            count = row['count']
            if type(count) is not int or count <= 0:
                raise ValueError('Invalid discrepancy count')
            result[json_key({key: value for key, value in row.items() if key != 'count'})] += count
        return result

    def restore(rows):
        return [dict(json.loads(key), count=count) for key, count in sorted(rows.items())]

    actual, frozen = counts(current), counts(known)
    return dict(new=restore(actual - frozen), resolved=restore(frozen - actual))
