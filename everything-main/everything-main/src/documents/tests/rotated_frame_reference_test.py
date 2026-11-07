"""Verify native frame evidence without treating a fitted candidate as a fix."""
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from record_rotated_frame import references, highlights, FOLDER


class RotatedFrameReference(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.refs = references()

    def test_all_original_inputs_and_native_outputs_are_bound(self):
        for variant, ref in self.refs.items():
            self.assertEqual(ref, json.loads((FOLDER / variant / 'native-reference.json').read_text()))
            self.assertEqual(sum(len(c['rows']) for c in ref['cases']), 432)

    def test_highlights_and_one_twip_page_margin_preserve_local_text_origins(self):
        for a, b in zip(self.refs['highlight']['cases'], self.refs['margin']['cases']):
            self.assertEqual(a['rows'], b['rows'])
            self.assertEqual(len(a['highlightRectangles']), 12)

    def test_backward_origin_shift_also_moves_the_highlight_frame(self):
        a, b = self.refs['highlight']['cases'][:2]
        self.assertEqual(a['rows'][8]['logicalX'], 1375)
        self.assertEqual(b['rows'][8]['logicalX'], 1374)
        self.assertEqual(a['highlightRectangles'][8]['x'], 1356)
        self.assertEqual(b['highlightRectangles'][8]['x'], 1356)
        # The left edge stays fixed here; the far edge loses one drawing unit.
        self.assertEqual(a['highlightRectangles'][8]['width'], 99)
        self.assertEqual(b['highlightRectangles'][8]['width'], 98)

    def test_expanded_spacing_changes_initial_baseline_for_two_faces(self):
        cases = self.refs['multiple']['cases']
        for start in (0, 12):
            self.assertEqual([cases[start+i]['rows'][0]['logicalX'] for i in (0, 4, 8)], [79, 80, 80])
            self.assertEqual([cases[start+i]['rows'][6]['logicalX'] for i in (0, 4, 8)], [1571, 1570, 1570])
        self.assertEqual([cases[i]['rows'][0]['logicalX'] for i in (24, 28, 32)], [71, 71, 71])

    def test_unknown_highlight_operation_is_rejected(self):
        data = bytearray((FOLDER / 'highlight/native-table-1.emf').read_bytes())
        offset = 0
        while offset < len(data):
            kind, size = struct.unpack_from('<II', data, offset)
            if kind == 76:
                struct.pack_into('<I', data, offset + 40, 0x00cc0020)
                break
            offset += size
        with self.assertRaises(ValueError):
            highlights(data)


if __name__ == '__main__':
    unittest.main()
