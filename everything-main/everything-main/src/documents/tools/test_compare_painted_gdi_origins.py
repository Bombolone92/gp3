"""Native-reference and rejection checks for the bounded origin diagnostic."""
import copy
import json
import struct
import tempfile
import unittest
from pathlib import Path
from compare_painted_gdi_origins import compare, sha
from inspect_emf_text_records import inspect

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/numbering-tracking-alignment'


class OriginDiagnostic(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.paint_path = self.root / 'paint.json'
        self.native = self.root / 'native'
        self.native.mkdir()
        meta = json.loads((FIXTURE/'native/page-capture.json').read_text(encoding='utf-8-sig'))
        self.meta = meta
        self.paint = dict(sourceSha256=meta['sourceSha256'], pages=12, rows=[])
        reference = json.loads((FIXTURE/'reference.json').read_text())
        for page, capture in enumerate(meta['captures']):
            data = (FIXTURE/'native'/capture['file']).read_bytes()
            (self.native/capture['file']).write_bytes(data)
            native_rows = inspect(data)
            for case in reference['cases'][page*9:page*9+9]:
                row = next(r for r in native_rows if r['text'].strip()==case['label']
                           and abs(r['logicalOrigin'][1]*.12-case['baselinePt']) < .001)
                x = row['logicalOrigin'][0]*.12
                origins = []
                for advance in row['advances']:
                    origins.append(x)
                    x += advance*.12
                self.paint['rows'].append(dict(page=page, text=row['text'],
                    font=f'16px "{case["family"]}", "Canvas Noto Sans"',
                    replayAdvanceErrorPx=0, differentPixels=0, alphaAbsoluteError=0,
                    originsPt=origins, baselinePt=case['baselinePt']))
        self.write()

    def write(self):
        self.paint_path.write_text(json.dumps(self.paint))
        (self.native/'page-capture.json').write_text(json.dumps(self.meta))

    def run_comparison(self):
        return compare(FIXTURE/'control.docx', self.paint_path, self.native)

    def test_retained_native_labels_and_css_fallback_list(self):
        result = self.run_comparison()
        self.assertEqual(result['matched'], 108)
        self.assertEqual(result['glyphs'], 180)
        self.assertEqual(result['excluded'], [])
        self.assertLess(result['maxAbsoluteXPt'], 1e-10)

    def test_source_mismatch_rejected(self):
        self.paint['sourceSha256'] = '0'*64
        self.write()
        with self.assertRaises(AssertionError): self.run_comparison()

    def test_nonexact_mask_rejected(self):
        self.paint['rows'][0]['differentPixels'] = 1
        self.write()
        for include_bmp in (False, True):
            with self.subTest(include_bmp=include_bmp):
                with self.assertRaises(AssertionError):
                    compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bmp=include_bmp)

    def test_bold_requires_explicit_opt_in(self):
        self.paint['rows'][0]['font'] = 'bold ' + self.paint['rows'][0]['font']
        self.write()
        with self.assertRaises(AssertionError): self.run_comparison()

    def test_bmp_requires_opt_in_and_exact_native_identity(self):
        # Synthetic text-only mutation tests Unicode pairing, not reference shaping.
        # Find the native record corresponding to the first retained paint row.
        row = self.paint['rows'][0]
        path = self.native/'page-1.emf'
        data = bytearray(path.read_bytes())
        offset = 0
        while offset < len(data):
            kind, length = struct.unpack_from('<II', data, offset)
            if kind == 84:
                count, string = struct.unpack_from('<II', data, offset+44)
                text = bytes(data[offset+string:offset+string+count*2]).decode('utf-16-le')
                x, y = struct.unpack_from('<ii', data, offset+36)
                if text == row['text'] and abs(y*.12-row['baselinePt']) < .001:
                    struct.pack_into('<H', data, offset+string, 0x2019)
                    break
            offset += length
        else:
            self.fail('Missing retained native row')
        path.write_bytes(data)
        self.meta['captures'][0].update(sha256=sha(path))
        row['text'] = '\u2019' + row['text'][1:]
        self.write()
        with self.assertRaises(AssertionError): self.run_comparison()
        result = compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bmp=True)
        self.assertEqual(result['matched'], 108)
        self.assertEqual(result['excluded'], [])
        row['text'] = '\u2018' + row['text'][1:]
        self.write()
        result = compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bmp=True)
        self.assertEqual(result['matched'], 107)
        self.assertEqual(len(result['excluded']), 1)

    def test_bmp_rejects_supplementary_surrogate_and_control_units(self):
        original = self.paint['rows'][0]['text']
        for char in ['\U0001f600', '\ud800', '\udfff', '\x01', '\x85']:
            with self.subTest(char=repr(char)):
                self.paint['rows'][0]['text'] = char + original[1:]
                self.write()
                with self.assertRaises(AssertionError):
                    compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bmp=True)

    def test_bold_never_borrows_regular_native_origins(self):
        self.paint['rows'][0]['font'] = 'bold ' + self.paint['rows'][0]['font']
        self.write()
        result = compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bold=True)
        self.assertEqual(result['matched'], 107)
        self.assertEqual(len(result['excluded']), 1)
        self.assertIn('same-weight', result['excluded'][0]['reason'])

    def test_other_weights_and_italic_remain_out_of_scope(self):
        original = self.paint['rows'][0]['font']
        for prefix in ('300 ', '450 ', '500 ', '600 ', 'bolder ', 'italic ', 'oblique '):
            with self.subTest(prefix=prefix):
                self.paint['rows'][0]['font'] = prefix + original
                self.write()
                with self.assertRaises(AssertionError):
                    compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bold=True)

    def test_explicit_bold_and_numeric_700_match_only_native_700(self):
        # Synthetic weight-only record mutation tests the diagnostic's selector,
        # not reference typography. All native positions remain unchanged.
        for capture in self.meta['captures']:
            path = self.native/capture['file']
            data = bytearray(path.read_bytes())
            offset = 0
            while offset < len(data):
                kind, length = struct.unpack_from('<II', data, offset)
                if kind == 82:
                    struct.pack_into('<i', data, offset+28, 700)
                offset += length
            path.write_bytes(data)
            capture['sha256'] = sha(path)
        for index, row in enumerate(self.paint['rows']):
            row['font'] = ('bold ' if index % 2 else '700 ') + row['font']
        self.write()
        result = compare(FIXTURE/'control.docx', self.paint_path, self.native, include_bold=True)
        self.assertEqual(result['matched'], 108)
        self.assertEqual(result['excluded'], [])
        self.assertLess(result['maxAbsoluteXPt'], 1e-10)

    def test_duplicate_native_glyph_assignment_rejected(self):
        self.paint['rows'].append(copy.deepcopy(self.paint['rows'][0]))
        self.write()
        with self.assertRaises(AssertionError): self.run_comparison()

    def test_changed_native_file_rejected(self):
        path = self.native/'page-1.emf'
        path.write_bytes(path.read_bytes()+b'broken')
        with self.assertRaises(AssertionError): self.run_comparison()

    def test_world_transform_at_text_rejected(self):
        path = self.native/'page-1.emf'
        data = path.read_bytes()
        offset = 0
        while struct.unpack_from('<I', data, offset)[0] != 84:
            offset += struct.unpack_from('<I', data, offset+4)[0]
        transform = struct.pack('<II6fI', 36, 36, 2, 0, 0, 2, 0, 0, 2)
        path.write_bytes(data[:offset]+transform+data[offset:])
        self.meta['captures'][0].update(length=path.stat().st_size, sha256=sha(path))
        self.write()
        with self.assertRaises(AssertionError): self.run_comparison()

    def test_scoped_nontext_scale_restored_before_text(self):
        path = self.native/'page-1.emf'
        data = path.read_bytes()
        offset = 0
        while struct.unpack_from('<I', data, offset)[0] != 84:
            offset += struct.unpack_from('<I', data, offset+4)[0]
        drawing_state = (struct.pack('<II', 33, 8)
                         + struct.pack('<II6fI', 36, 36, 2, 0, 0, 2, 0, 0, 2)
                         + struct.pack('<IIi', 34, 12, -1))
        path.write_bytes(data[:offset]+drawing_state+data[offset:])
        self.meta['captures'][0].update(length=path.stat().st_size, sha256=sha(path))
        self.write()
        self.assertEqual(self.run_comparison()['matched'], 108)


if __name__ == '__main__': unittest.main()
