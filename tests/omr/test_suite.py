import copy
import json
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET

from run import check_frozen_cases, load_baseline
from suite import FIXTURES, checked_file, compare_baseline, compare_marks, compare_score, load_manifest


def score(identifier):
    return ET.parse(FIXTURES / (identifier + '.musicxml')).getroot()


def remove_ties(note):
    for tie in note.findall('tie'):
        note.remove(tie)
    for notations in note.findall('notations'):
        for tied in notations.findall('tied'):
            notations.remove(tied)


class OMRTestSet(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases, cls.manifest_hash = load_manifest()
        cls.baseline = load_baseline(FIXTURES / 'baseline.json', cls.cases, cls.manifest_hash)

    def test_frozen_references_match_their_own_musical_signatures(self):
        for identifier, case in self.cases.items():
            if case['kind'] == 'pdf':
                with self.subTest(identifier):
                    truth = score(identifier)
                    self.assertEqual(compare_score(truth, truth)['discrepancies'], [])

    def test_grace_slur_replaced_by_tie_is_the_frozen_failure(self):
        truth = score('grace-slur')
        reading = copy.deepcopy(truth)
        grace, principal = reading.findall('part/measure[@number="2"]/note')[:2]
        for note, kind in [(grace, 'start'), (principal, 'stop')]:
            notation = note.find('notations')
            notation.remove(notation.find('slur'))
            ET.SubElement(notation, 'tied', type=kind)
            ET.SubElement(note, 'tie', type=kind)
        discrepancies = compare_score(truth, reading)['discrepancies']
        known = self.baseline['cases']['grace-slur']['discrepancies']
        self.assertEqual(compare_baseline(discrepancies, known), dict(new=[], resolved=[]))
        self.assertEqual({row['category'] for row in discrepancies},
                         {'core-event', 'attack', 'slur', 'grace-playback-tie', 'tied'})
        self.assertEqual(compare_baseline([], known), dict(new=[], resolved=known))

    def test_ordinary_slur_loss_has_unchanged_timed_events(self):
        truth = score('tie-controls')
        reading = copy.deepcopy(truth)
        for notation in reading.findall('part/measure[@number="2"]/note/notations'):
            for slur in notation.findall('slur'):
                notation.remove(slur)
        result = compare_score(truth, reading)
        self.assertEqual(result['core']['events']['correct'], 15)
        self.assertEqual([row['category'] for row in result['discrepancies']], ['slur'])
        self.assertTrue(compare_baseline(result['discrepancies'], [])['new'])

    def test_reversing_graces_is_detected_even_if_the_unordered_count_matches(self):
        truth = score('tie-controls')
        reading = copy.deepcopy(truth)
        bar = reading.find('part/measure[@number="3"]')
        second = bar.find('note[2]')
        bar.remove(second)
        bar.insert(0, second)
        result = compare_score(truth, reading)
        self.assertEqual(result['core']['graces']['correct'], 2)
        self.assertIn('grace-order', {item['category'] for item in result['discrepancies']})

    def test_erasing_every_tie_introduces_a_new_missing_span(self):
        truth = score('tie-within-bar')
        reading = copy.deepcopy(truth)
        for note in reading.findall('part/measure/note'):
            remove_ties(note)
        actual = compare_score(truth, reading)['discrepancies']
        gate = compare_baseline(actual, self.baseline['cases']['tie-within-bar']['discrepancies'])
        self.assertTrue(any(row['category'] == 'tied' and row['item']['measure'] == 3 for row in gate['new']))

    def test_required_meter_and_source_beams_are_separate_from_matching_notes(self):
        truth = score('quintuplet-score')
        reading = copy.deepcopy(truth)
        reading.find('part/measure[@number="3"]/attributes/time/beats').text = '6'
        note = reading.find('part/measure[@number="2"]/note')
        note.find('beam').text = 'backward hook'
        result = compare_score(truth, reading)
        self.assertEqual(result['core']['events']['correct'], 18)
        self.assertEqual({row['category'] for row in result['discrepancies']}, {'meter', 'beam'})

    def test_case_errors_cannot_move_to_another_measure_or_grow_in_count(self):
        record = dict(category='core-event', operation='missing', item={'measure': 2, 'pitch': 'G'}, count=1)
        moved = dict(record, item={'measure': 3, 'pitch': 'G'})
        self.assertEqual(compare_baseline([moved], [record]), dict(new=[moved], resolved=[record]))
        self.assertEqual(compare_baseline([dict(record, count=2)], [record])['new'], [record])

    def test_crop_control_fails_a_false_digit_and_multiple_sightings(self):
        mark = self.cases['tuplet-fragment']['marks'][0]
        self.assertEqual(compare_marks([mark], [mark]), [])
        self.assertEqual(compare_marks([], [mark])[0]['operation'], 'extra')
        self.assertEqual(compare_marks([mark], [mark, mark])[0]['count'], 1)

    def test_changed_input_bytes_and_missing_baseline_cases_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            changed = json.loads((FIXTURES / 'baseline.json').read_text())
            changed['cases'].pop('tie-controls')
            invalid = path / 'baseline.json'
            invalid.write_text(json.dumps(changed))
            with self.assertRaisesRegex(ValueError, 'cover every manifest case'):
                load_baseline(invalid, self.cases, self.manifest_hash)
            asset = self.cases['grace-slur']['source']
            (path / asset['file']).write_bytes(b'%PDF-modified')
            with self.assertRaisesRegex(ValueError, 'Frozen file changed'):
                checked_file(path, asset)

    def test_existing_reference_bytes_cannot_be_replaced_in_a_pr(self):
        before = json.loads((FIXTURES / 'manifest.json').read_bytes())
        after = copy.deepcopy(before)
        after['cases'][0]['truth']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'existing v1 case or reference changed'):
            check_frozen_cases(before, self.baseline, after, self.baseline)

    def test_a_pr_can_remove_an_allowance_but_cannot_restore_it_later(self):
        manifest = json.loads((FIXTURES / 'manifest.json').read_bytes())
        improved = copy.deepcopy(self.baseline)
        improved['cases']['grace-slur']['discrepancies'].pop()
        check_frozen_cases(manifest, self.baseline, manifest, improved)
        with self.assertRaisesRegex(ValueError, 'introduces new allowed discrepancies'):
            check_frozen_cases(manifest, improved, manifest, self.baseline)


if __name__ == '__main__':
    unittest.main()
