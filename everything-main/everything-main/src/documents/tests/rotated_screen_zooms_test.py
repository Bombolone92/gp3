from pathlib import Path
import json
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from record_rotated_screen_zooms import record,glyph_bounds,FOLDER


class RotatedScreenZooms(unittest.TestCase):
    def test_recorded_measurements_and_hashes_are_reproducible(self):
        self.assertEqual(record(),json.loads((FOLDER/'reference.json').read_text()))

    def test_both_native_zooms_keep_all_six_glyph_bounds_stationary(self):
        observations=record()['observations']
        self.assertEqual([o['zoomPercent'] for o in observations],[100,200])
        for observation in observations:
            self.assertEqual(observation['translationX'],[0]*6)
            a,b=observation['screens']
            self.assertEqual([g['bounds'][::2] for g in a],[g['bounds'][::2] for g in b])
            self.assertEqual(len(a),6)

    def test_wrong_window_size_and_empty_crop_are_rejected(self):
        path=FOLDER/'native-both-100.png'
        with self.assertRaisesRegex(ValueError,'dimensions'):glyph_bounds(path,[400,230,110,20],[100,100])
        with self.assertRaisesRegex(ValueError,'six isolated'):glyph_bounds(path,[0,0,1,1],[946,536])
        with self.assertRaisesRegex(ValueError,'Invalid'):glyph_bounds(path,[-1,0,1,1],[946,536])


if __name__=='__main__':unittest.main()
