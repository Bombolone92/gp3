import json
from pathlib import Path
import struct
import unittest
from record_emf_range_bitmaps import extract, record

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT/'tests/fixtures/emf-luminance-edges/range-native'

class NativeRangeEvidence(unittest.TestCase):
    def test_original_and_doubled_frame_reproduce_reference(self):
        for name, suffix in [('base',''), ('expanded','-expanded-frame'), ('overflow','-overflow-frame')]:
            with self.subTest(name=name):
                expected=json.loads((FOLDER/(name+'-reference.json')).read_text())
                actual=record(FOLDER/(name+'.emf'), ROOT/('tests/fixtures/emf-luminance-edges'+suffix))
                self.assertEqual(actual, expected)
                self.assertEqual([i['size'] for i in actual['images']], [[400,394],[599,590],[800,787],[402,398]])
                self.assertEqual([i['pdfSize'] for i in actual['images']], [[133,131],[199,196],[266,262],[133,132]])
                for image in actual['images']:
                    self.assertEqual(image['draws'], [dict(sourceRect=[-.5,-.5,*image['size']], points=[[0,0],[image['size'][0],0],[0,image['size'][1]]])])

    def test_truncated_capture_rejected(self):
        with self.assertRaisesRegex(ValueError, 'byte count'):
            extract((FOLDER/'base.emf').read_bytes()[:-4])

    def test_comment_cannot_read_next_record(self):
        data=bytearray((FOLDER/'base.emf').read_bytes())
        position=0
        while struct.unpack_from('<I',data,position)[0] != 70:
            position+=struct.unpack_from('<I',data,position+4)[0]
        struct.pack_into('<I',data,position+8,struct.unpack_from('<I',data,position+4)[0])
        with self.assertRaisesRegex(ValueError, 'Comment extends'):
            extract(data)

    def test_declared_records_verified(self):
        data=bytearray((FOLDER/'base.emf').read_bytes())
        struct.pack_into('<I',data,52,1)
        with self.assertRaisesRegex(ValueError, 'record count'):
            extract(data)

if __name__ == '__main__':
    unittest.main()
