"""Check the owned native reference's provenance and empty-shape invariance."""
from pathlib import Path
from hashlib import sha256
from io import BytesIO
from zipfile import ZipFile
import json,tempfile,unittest
from xml.etree import ElementTree as E
from PIL import Image
from record_svg_disabled_shapes import cached_png,record

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/svg-disabled-shapes'

class DisabledShapeReferenceTests(unittest.TestCase):
    def test_native_rows_and_capture_are_bound_to_the_authored_source(self):
        reference=json.loads((FOLDER/'reference.json').read_bytes())
        for path,key in [(ROOT/'public/fixtures/svg-disabled-shapes.docx','sourceSha256'),
                         (FOLDER/'capture.emf','captureSha256'),(FOLDER/'native-cached.png','pngSha256'),
                         (FOLDER/'capture.json','captureMetadataSha256')]:
            self.assertEqual(sha256(path.read_bytes()).hexdigest(),reference[key])
        for key in ['sourceUnchanged','savedBefore','savedAfter','captureReadOnly']:
            self.assertIs(reference[key],True)
        metadata=json.loads((FOLDER/'capture.json').read_text(encoding='utf-8-sig'))
        self.assertEqual(metadata['sourceSha256'],reference['sourceSha256'])
        self.assertEqual(metadata['captureSha256'],reference['captureSha256'])
        self.assertEqual(metadata['referenceBuild'],reference['referenceBuild'])
        self.assertEqual(metadata['pictureIndex'],1)
        for key in ['sourceUnchanged','savedBefore','savedAfter','captureReadOnly']:
            self.assertIs(metadata[key],True)
        png=cached_png((FOLDER/'capture.emf').read_bytes())
        self.assertEqual(png,(FOLDER/'native-cached.png').read_bytes())
        image=Image.open(BytesIO(png)).convert('RGBA')
        self.assertEqual(list(image.size),reference['size'])
        rows=[image.crop(row['box']).tobytes() for row in reference['rows']]
        self.assertEqual(len(rows),4)
        self.assertTrue(any(v<255 for i,v in enumerate(rows[0]) if i%4!=3))
        for row,pixels in zip(reference['rows'],rows):
            self.assertEqual(sha256(pixels).hexdigest(),row['rgbaSha256'])
            self.assertEqual(pixels,rows[0])
        with ZipFile(ROOT/'public/fixtures/svg-disabled-shapes.docx') as source:
            svg=E.fromstring(source.read('word/media/vector.svg'))
        groups=svg.findall('{http://www.w3.org/2000/svg}g')
        self.assertEqual(len(groups),4)
        self.assertEqual([len(g) for g in groups],[2,3,3,3])
        self.assertEqual([g[-1].tag.rsplit('}',1)[-1] for g in groups[1:]],['rect','circle','ellipse'])
        self.assertEqual([g.get('opacity') for g in groups],['.8']*4)

    def test_truncated_native_capture_is_rejected(self):
        capture=(FOLDER/'capture.emf').read_bytes()
        with self.assertRaises((AssertionError,ValueError)):
            cached_png(capture[:-1])

    def test_fresh_recording_reproduces_all_captured_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary)/'reference'
            record(FOLDER,output)
            for name in ['capture.emf','capture.json','native-cached.png','reference.json']:
                self.assertEqual((output/name).read_bytes(),(FOLDER/name).read_bytes())

    def test_existing_reference_directory_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);note=output/'existing.txt';note.write_bytes(b'Keep this evidence')
            with self.assertRaises(AssertionError):record(FOLDER,output)
            self.assertEqual(list(output.iterdir()),[note])
            self.assertEqual(note.read_bytes(),b'Keep this evidence')

if __name__=='__main__':unittest.main()
