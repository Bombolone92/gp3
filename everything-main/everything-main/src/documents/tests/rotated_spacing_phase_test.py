"""Independent native evidence; these are not renderer-fidelity assertions."""
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from record_rotated_spacing_phase import record, validate_wrapper, FOLDER
from record_rotated_phase_metafiles import baseline_records


class RotatedSpacingPhase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = record()

    def test_source_and_all_native_records_are_bound(self):
        self.assertEqual(self.reference, json.loads((FOLDER / 'native-reference.json').read_text()))
        self.assertEqual(len(self.reference['cases']), 36)
        self.assertEqual(sum(len(c['rows']) for c in self.reference['cases']), 432)

    def test_explicit_spacing_is_monotonic_for_every_font_and_both_directions(self):
        for index in [4, 8, 16, 20, 28, 32]:
            cases = self.reference['cases'][index:index + 4]
            for first, second in zip(cases, cases[1:]):
                self.assertTrue(all(b['logicalX'] >= a['logicalX'] for a, b in zip(first['rows'], second['rows'])))

    def test_fractional_explicit_spacing_does_not_require_font_specific_positions(self):
        cases = self.reference['cases']
        for offset in range(4, 12):
            self.assertEqual(cases[offset]['rows'], cases[offset + 12]['rows'])
            self.assertEqual(cases[offset]['rows'], cases[offset + 24]['rows'])

    def test_automatic_spacing_has_direction_and_font_dependence(self):
        cases = self.reference['cases']
        for index in [0, 12]:
            self.assertEqual(cases[index]['rows'][8]['logicalX'], 1375)
            self.assertEqual(cases[index + 1]['rows'][8]['logicalX'], 1374)
            for first, second in zip(cases[index:index+3], cases[index+1:index+4]):
                self.assertTrue(all(b['logicalX'] >= a['logicalX'] for a, b in zip(first['rows'][:6], second['rows'][:6])))
        for first, second in zip(cases[24:27], cases[25:28]):
            self.assertTrue(all(b['logicalX'] >= a['logicalX'] for a, b in zip(first['rows'], second['rows'])))

    def test_mapping_and_font_substitutions_are_rejected(self):
        data = (FOLDER / 'native-table-1.emf').read_bytes()
        with self.assertRaises(ValueError):
            baseline_records(data, face='Courier New', advance=50)
        altered = bytearray(data)
        offset = 0
        while offset < len(data):
            kind, size = struct.unpack_from('<II', data, offset)
            if kind == 84:
                struct.pack_into('<I', altered, offset + 24, 2)
                break
            offset += size
        with self.assertRaises(ValueError):
            validate_wrapper(altered)
        with self.assertRaises(ValueError):
            validate_wrapper(data[:-1])


if __name__ == '__main__':
    unittest.main()
