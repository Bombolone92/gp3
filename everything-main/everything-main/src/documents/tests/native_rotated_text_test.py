"""Native evidence invariants; these do not certify renderer fidelity."""
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/cell-text-direction/native-text'
spec = importlib.util.spec_from_file_location('emf_inspector', ROOT / 'tools/inspect_emf_text_records.py')
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)


class NativeRotatedText(unittest.TestCase):
    def test_bound_sources(self):
        manifest = json.loads((FIXTURE / 'manifest.json').read_text())
        for name, expected in manifest['sha256'].items():
            self.assertEqual(hashlib.sha256((FIXTURE / name).read_bytes()).hexdigest(), expected, name)
        positions = json.loads((FIXTURE / 'range-positions.json').read_text())
        self.assertEqual(positions['sourceSha256'], manifest['sha256']['../control.docx'])
        self.assertEqual(positions['referenceBuild'], manifest['referenceBuild'])

    def test_native_advances_do_not_change_with_rotation(self):
        rows = inspector.inspect((FIXTURE / 'table1.emf').read_bytes())
        self.assertEqual(rows, json.loads((FIXTURE / 'metafile-text.json').read_text()))
        labels = [r for r in rows if r['text'] == 'Alpha beta']
        self.assertEqual([r['font']['orientation'] for r in labels], [0, 900, 2700])
        for row in labels:
            self.assertEqual(row['font']['face'], 'Arial')
            self.assertEqual(row['advances'], [55,18,47,46,46,24,46,46,24,47])

    def test_range_api_has_coarse_coordinates_and_directional_advances(self):
        data = json.loads((FIXTURE / 'range-positions.json').read_text())
        self.assertEqual(len(data['cases']), 18)
        for case in data['cases']:
            for p in case['positions']:
                for axis in ('x', 'y'):
                    self.assertAlmostEqual(p[axis] / .75, round(p[axis] / .75))
        for case, axis, sign in zip(data['cases'][:3], ('x','y','y'), (1,-1,1)):
            coordinates = [p[axis] for p in case['positions']]
            self.assertTrue(all(sign * (b-a) > 0 for a,b in zip(coordinates, coordinates[1:])))

    def test_truncated_native_record_is_rejected(self):
        with self.assertRaises(ValueError):
            inspector.inspect((FIXTURE / 'table1.emf').read_bytes()[:-1])


if __name__ == '__main__':
    unittest.main()
