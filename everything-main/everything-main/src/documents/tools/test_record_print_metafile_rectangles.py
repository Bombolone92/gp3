"""Independent byte-field controls for the narrow raw-operation recorder."""
import struct
import unittest
import tempfile,json,hashlib
from pathlib import Path
from zipfile import ZipFile
from record_print_metafile_rectangles import rectangles,record as record_capture


def record(kind,payload):
    return struct.pack('<II',kind,8+len(payload))+payload


def page(prefix=b'',rop=0x00f00021,frames=1):
    header=record(1,struct.pack('<8i',0,0,5100,3300,0,0,21590,13970)+bytes(48))
    window=record(9,struct.pack('<2i',5100,3300))
    brush=record(39,struct.pack('<4I',2,0,0x02917f6d,0))
    select=record(37,struct.pack('<I',2))
    # Bounds occupy 16 bytes before the destination fields in EMR_BITBLT.
    blit=record(76,bytes(16)+struct.pack('<4iI',300,1856,8,8,rop)+bytes(52))
    return header+window+brush+select+prefix+blit*(12*frames)


class RawOperationTests(unittest.TestCase):
    def capture_with_case(self,root,case):
        root=Path(root).resolve()
        self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
        fixture=root/'fixture';fixture.mkdir();capture=root/'capture';capture.mkdir()
        with ZipFile(fixture/'control.docx','w') as package:
            package.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sectPr><w:pgSz w:w="12240" w:h="7920"/></w:sectPr></w:body></w:document>')
        (fixture/'cases.json').write_text(json.dumps([case]),encoding='utf-8')
        (capture/'page-1.emf').write_bytes(page())
        digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
        metadata={'sourceSha256':digest(fixture/'control.docx'),'sourceUnchanged':True,'savedAfter':True,'referenceBuild':'synthetic byte control',
            'pages':[{'page':1,'widthPt':612,'heightPt':396,'sha256':digest(capture/'page-1.emf')}]}
        (capture/'metadata.json').write_text(json.dumps(metadata),encoding='utf-8')
        return capture,fixture

    def test_source_sections_supply_missing_case_dimensions(self):
        with tempfile.TemporaryDirectory() as root:
            capture,fixture=self.capture_with_case(root,{'index':0,'page':0})
            result=record_capture(capture,fixture)
            self.assertEqual(result['pages'][0]['windowExtent'],(5100,3300))
            self.assertTrue(result['sourceUnchanged'])

    def test_case_geometry_must_agree_with_authored_sections(self):
        with tempfile.TemporaryDirectory() as root:
            capture,fixture=self.capture_with_case(root,{'index':0,'page':0,'pageWidthPt':600})
            with self.assertRaises(AssertionError):record_capture(capture,fixture)

    def test_flowing_frames_require_the_declared_count(self):
        self.assertEqual(len(rectangles(page(frames=16),16)['fills']),192)
        with self.assertRaises(AssertionError):rectangles(page(frames=16))
        for count in [0,-1,1.5,True]:
            with self.assertRaises(AssertionError):rectangles(page(),count)

    def test_destination_fields_and_palette_rgb(self):
        result=rectangles(page())
        self.assertEqual(result['windowExtent'],(5100,3300))
        self.assertEqual(result['fills'],[{'colorRef':0x917f6d,'destination':[300,1856,8,8],'clips':[]}]*12)

    def test_unsupported_raster_operation_rejected(self):
        with self.assertRaises(AssertionError): rectangles(page(rop=0x00cc0020))

    def test_transformed_coordinates_rejected(self):
        with self.assertRaisesRegex(AssertionError,'Nonidentity mapping'):
            rectangles(page(record(35,struct.pack('<6f',2,0,0,2,0,0))))

    def test_border_clip_rejected(self):
        with self.assertRaises(AssertionError):
            rectangles(page(record(30,struct.pack('<4i',300,1856,304,1860))))

    def test_restored_clip_does_not_affect_border(self):
        prefix=record(33,b'')+record(30,struct.pack('<4i',300,1856,304,1860))+record(34,struct.pack('<i',-1))
        self.assertEqual(len(rectangles(page(prefix))['fills']),12)

    def test_stock_brush_cannot_reuse_previous_color(self):
        with self.assertRaises(AssertionError):
            rectangles(page(record(37,struct.pack('<I',0x80000005))))


if __name__=='__main__': unittest.main()
