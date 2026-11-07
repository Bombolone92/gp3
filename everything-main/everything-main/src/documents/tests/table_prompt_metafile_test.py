"""Native control integrity and isolation; not a renderer parity assertion."""
import json
from pathlib import Path
import struct
import sys
import shutil
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from record_table_prompt_metafiles import FOLDER, record, label_record


class TablePromptMetafiles(unittest.TestCase):
    def test_source_binding_and_equivalent_control_placement(self):
        reference = record()
        self.assertEqual(reference, json.loads((FOLDER / 'native-reference.json').read_text()))
        cases = reference['cases']
        self.assertEqual(len(cases), 6)
        for case in cases:
            self.assertEqual(case['logicalOrigin'], [95, 148])
            self.assertEqual(case['logicalUnitPtByAxis'][0], .12)
            self.assertEqual(case['borderRectangles'], cases[0]['borderRectangles'])
        # This eliminates a wrapper-specific baseline shift in this authored
        # control. Its native coordinates do not establish the corpus cause.
        self.assertEqual(len({tuple(c['logicalOrigin']) for c in cases}), 1)

    def test_rejects_unmapped_alignment_transform_and_border_changes(self):
        data = (FOLDER / 'native-table-1.emf').read_bytes()
        with self.assertRaises(ValueError):
            label_record(data[:-1])
        for target, position, value in [(22, 8, 0), (9, 0, 11), (76, 40, 0xCC0020)]:
            with self.subTest(record=target):
                changed = bytearray(data)
                offset = 0
                while offset < len(data):
                    kind, size = struct.unpack_from('<II', data, offset)
                    if kind == target:
                        struct.pack_into('<I', changed, offset + position, value)
                        break
                    offset += size
                with self.assertRaises(ValueError):
                    label_record(changed)

    def test_rejects_replacement_font(self):
        data = bytearray((FOLDER / 'native-table-1.emf').read_bytes())
        offset = 0
        while offset < len(data):
            kind, size = struct.unpack_from('<II', data, offset)
            if kind == 82 and struct.unpack_from('<i', data, offset + 12)[0] == -150:
                struct.pack_into('<i', data, offset + 28, 400)
                break
            offset += size
        with self.assertRaises(ValueError):
            label_record(data)

    def test_rejects_second_drawing_stream(self):
        data = bytearray((FOLDER / 'native-table-1.emf').read_bytes())
        offset = 0
        while offset < len(data):
            kind, size = struct.unpack_from('<II', data, offset)
            if kind == 70:
                struct.pack_into('<H', data, offset + 16, 0x401C)  # DrawString
                break
            offset += size
        with self.assertRaises(ValueError):
            label_record(data)

    def test_rejects_source_change(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            shutil.copy(FOLDER / 'native-capture.json', folder)
            (folder / 'control.docx').write_bytes((FOLDER / 'control.docx').read_bytes() + b'changed')
            with self.assertRaises(ValueError):
                record(folder)


if __name__ == '__main__':
    unittest.main()
