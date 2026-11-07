"""Independent source/native metadata checks; no art assets are loaded."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile
from xml.etree import ElementTree as E
import json,struct,tempfile,unittest
from page_art_selection_fixture import build,generate,CASES
from record_page_art_selection import polygons

ROOT=Path(__file__).resolve().parents[1];FOLDER=ROOT/'tests/fixtures/page-art-selection'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def record(kind,payload=b''):
    return struct.pack('<II',kind,8+len(payload))+payload

def simple_capture():
    return (record(1,bytes(80))+record(17,struct.pack('<I',8))+
            record(9,struct.pack('<2i',10,10))+record(11,struct.pack('<2i',20,20))+
            record(39,struct.pack('<4I',1,0,0x443322,0))+record(37,struct.pack('<I',1))+
            record(86,struct.pack('<4iI6h',0,0,10,10,3,0,0,10,0,0,10))+record(14))

class PageArtSelectionTests(unittest.TestCase):
    def test_source_and_native_selection_findings_are_bound(self):
        reference=json.loads((FOLDER/'native-reference.json').read_bytes())
        for name,key in [('control.docx','sourceSha256'),('cases.json','casesSha256')]:
            self.assertEqual(sha256((FOLDER/name).read_bytes()).hexdigest(),reference[key])
        cases=json.loads((FOLDER/'cases.json').read_bytes());self.assertEqual(len(cases),21)
        pages=reference['pages'];self.assertEqual(len(pages),21)
        self.assertEqual([len(p['polygons']) for p in pages],[8,3,3,3,3,5,6,5,5,6,5,8,8,8,8,0,0,0,8,7,8])
        for case,page in zip(cases,pages):
            self.assertEqual(case['name'],page['name'])
            self.assertTrue(all(p['mapping']['brush']==0x443322 for p in page['polygons']))
        # The supplied width permutations are not independent side widths.
        self.assertEqual([p['polygons'][0]['mapping']['viewportExtent'] for p in pages[11:15]],[[58,58],[258,258],[175,175],[117,117]])
        # When top is ordinary, the first art declaration is the left's 21pt.
        self.assertEqual(pages[20]['polygons'][0]['mapping']['viewportExtent'],[175,175])
        self.assertEqual(pages[0]['polygons'],pages[11]['polygons'])
        self.assertEqual(pages[0]['polygons'],pages[18]['polygons'])
        for key in ['sourceUnchanged','savedBefore','savedAfter']:self.assertIs(reference[key],True)
        # No usable polygon vertex arrays or tile pixels are retained.
        self.assertTrue(all(set(p)=={'declaredBounds','pointCount','pointBytesSha256','mapping'} for page in pages for p in page['polygons']))

    def test_repeat_proof_is_bound_to_the_reference(self):
        raw=(FOLDER/'native-reference.json').read_bytes()
        reference=json.loads(raw)
        proof=json.loads((FOLDER/'repeat-proof.json').read_bytes())
        self.assertEqual(proof['referenceSha256'],sha256(raw).hexdigest())
        for key in ['sourceSha256','casesSha256','referenceBuild','sourceUnchanged','savedBefore','savedAfter','captureMetadataSha256']:
            self.assertEqual(proof[key],reference[key])
        self.assertRegex(proof['repeatCaptureMetadataSha256'],r'^[0-9a-f]{64}$')
        self.assertEqual(proof['pages'],[{k:p[k] for k in ['name','page','metafileSha256']} for p in reference['pages']])

    def test_deterministic_authored_parts_and_canonical_side_order(self):
        with ZipFile(FOLDER/'control.docx') as source:
            self.assertEqual({n:source.read(n) for n in source.namelist()},build())
            root=E.fromstring(source.read('word/document.xml'))
        self.assertEqual(root.findall('.//'+W+'t'),[])
        sections=root.findall('.//'+W+'sectPr');self.assertEqual(len(sections),21)
        for section,case in zip(sections,CASES):
            sides=[n.tag.rsplit('}',1)[-1] for n in section.find(W+'pgBorders')]
            self.assertEqual(sides,case['sides'])

    def test_generated_source_refuses_to_replace_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary)/'source';generate(folder)
            before={p.name:p.read_bytes() for p in folder.iterdir()}
            with self.assertRaises(ValueError):generate(folder)
            self.assertEqual({p.name:p.read_bytes() for p in folder.iterdir()},before)

    def test_polygon_metadata_and_unknown_nested_drawing_rejection(self):
        capture=simple_capture();row=polygons(capture)[0]
        self.assertEqual(row['declaredBounds'],[0,0,10,10]);self.assertEqual(row['pointCount'],3)
        self.assertEqual(row['mapping']['brush'],0x443322)
        with self.assertRaises(AssertionError):polygons(capture[:-1])
        with self.assertRaises(AssertionError):polygons(capture[88:])
        # An EMF+ draw/image object cannot disappear behind ignored comments.
        plus=struct.pack('<HHII',0x4008,0,12,0)
        comment=record(70,struct.pack('<I',4+len(plus))+b'EMF+'+plus)
        with self.assertRaises(AssertionError):polygons(capture[:-8]+comment+record(14))
        with self.assertRaises(AssertionError):polygons(capture[:-8]+record(35,bytes(24))+record(14))

if __name__=='__main__':unittest.main()
