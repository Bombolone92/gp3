"""Keep screen/export evidence and held-out font sizes distinct."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from record_rotated_live import record as live, FOLDER as LIVE
from record_rotated_baseline_scale import record as scale, FOLDER as SCALE
from record_rotated_phase_metafiles import baseline_records


class RotatedLiveReference(unittest.TestCase):
    def test_live_input_and_native_captures_match_recorded_evidence(self):
        self.assertEqual(live(), json.loads((LIVE/'comparison.json').read_text()))

    def test_screen_does_not_show_native_export_backward_glyph_steps(self):
        ref = live()
        self.assertEqual(ref['nativeBaselineDeltasPt'], [.12, .12, -.12, .24, -.12, .24])
        for a, b in zip(*ref['screens']):
            self.assertEqual(a['bounds'][::2], b['bounds'][::2])
        self.assertLess(max(abs(d) for d in ref['screenCentroidDeltasPx']), .02)
        # This constrains these observed pixels, not the reference application's internal layout or
        # every zoom/device. Do not use it to erase the export discrepancy.

    def test_all_font_size_and_leading_controls_are_bound(self):
        ref = scale()
        self.assertEqual(ref, json.loads((SCALE/'native-reference.json').read_text()))
        self.assertEqual(len(ref['cases']), 48)
        self.assertEqual(sum(len(c['rows']) for c in ref['cases']), 576)
        self.assertEqual({c['size'] for c in ref['cases']}, {8, 12, 20})
        self.assertEqual({c['multiple'] for c in ref['cases']}, {180, 240, 300, 420})

    def test_wrong_font_height_and_direction_are_rejected(self):
        data = (LIVE/'native-table-1.emf').read_bytes()
        for options in [dict(height=-84, directions=('tbRl',)*6), dict(directions=('btLr',)*6)]:
            with self.assertRaisesRegex(ValueError, 'Unexpected reference font'):
                baseline_records(data, **options)
        with self.assertRaisesRegex(ValueError, 'labels/directions'):
            baseline_records(data)


if __name__ == '__main__':
    unittest.main()
