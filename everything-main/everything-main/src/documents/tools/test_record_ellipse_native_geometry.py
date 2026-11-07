from pathlib import Path
import json, struct, unittest
from record_ellipse_native_geometry import geometry

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/ellipse-native-geometry'

class NativeGeometry(unittest.TestCase):
    def altered(self,kind,offset,fmt,value):
        data=bytearray((ROOT/'native.emf').read_bytes());position=0
        while position<len(data):
            current,size=struct.unpack_from('<II',data,position)
            if current==kind:
                struct.pack_into(fmt,data,position+offset,value);return data
            position+=size
        self.fail('Record not found')

    def test_capture_reproduces_recorded_geometry(self):
        actual=geometry((ROOT/'native.emf').read_bytes())
        expected=json.loads((ROOT/'reference.json').read_text())
        self.assertEqual(json.loads(json.dumps(actual['paths'])),expected['paths'])

    def test_refuses_wrong_cubic_point_count(self):
        with self.assertRaises(AssertionError):geometry(self.altered(85,24,'<I',12))

    def test_refuses_unaccounted_mapping_origin(self):
        with self.assertRaises(AssertionError):geometry(self.altered(10,8,'<i',1))

    def test_refuses_nonuniform_transform(self):
        with self.assertRaises(AssertionError):geometry(self.altered(36,20,'<f',.125))

if __name__=='__main__':unittest.main()
