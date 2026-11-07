from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
import json
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from compare_pdf_char_origins import compare,horizontal_matrix,read_chars,read_metadata_chars


def metadata_pdf(to_unicode=True, simple_encoding=None):
    # Independently written text operators, widths and ToUnicode. The fake
    # embedded program is deliberately forbidden; no actual font is included.
    cmap=b'1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0041> <0002> <0062> endbfchar'
    stream=lambda data,attrs=b'':b'<< /Length '+str(len(data)).encode()+b' '+attrs+b' >>\nstream\n'+data+b'\nendstream'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
             b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
             b'<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [6 0 R] '+(b'/ToUnicode 8 0 R' if to_unicode else b'')+b' >>',
             stream(b'BT /F1 10 Tf 20 150 Td <0001> Tj 3 Ts <0002> Tj ET'),
             b'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 600 >>',
             b'<< /Type /FontDescriptor /FontName /Fixture /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 9 0 R >>',
             stream(cmap),stream(b'not-a-font-program',b'/FixtureForbidden true')]
    if simple_encoding is not None:
        # A simple TrueType font deliberately has no ToUnicode. Its explicit
        # encoding, widths, fractional size, tracking and TJ adjustment must
        # remain authoritative without consulting the fake embedded program.
        objects[3]=(b'<< /Type /Font /Subtype /TrueType /BaseFont /Fixture '
                    b'/FirstChar 32 /LastChar 98 /Widths ['+b'600 '*67+
                    b'] /FontDescriptor 7 0 R /Encoding '+simple_encoding+b' >>')
        objects[4]=stream(b'BT /F1 9.96 Tf 1 Tc 80 Tz 20 150 Td [(A) -25 (b)] TJ ET')
    data=b'%PDF-1.4\n';offsets=[0]
    for index,obj in enumerate(objects,1):
        offsets.append(len(data));data+=f'{index} 0 obj\n'.encode()+obj+b'\nendobj\n'
    xref=len(data);data+=f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    data+=b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return data+f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()


def glyphs(text,x,y,index=0):
    return [dict(text=c,x=x+i*6,y=y,index=index+i) for i,c in enumerate(text)]


class PDFOrigins(unittest.TestCase):
    def test_simple_truetype_declared_encoding_and_fractional_advances_without_font_programs(self):
        from pdfminer.pdftypes import PDFStream
        original=PDFStream.get_data
        def guarded(stream):
            if stream.attrs.get('FixtureForbidden'):
                raise AssertionError('Embedded font program was decoded')
            return original(stream)
        encodings=[(b'/WinAnsiEncoding','Ab'),
                   (b'<< /BaseEncoding /WinAnsiEncoding /Differences [65 /a 98 /B] >>','aB')]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'simple.pdf'
            for encoding,expected in encodings:
                path.write_bytes(metadata_pdf(simple_encoding=encoding))
                with patch.object(PDFStream,'get_data',guarded):
                    chars=read_metadata_chars(str(path))[0]
                    annotated=read_metadata_chars(str(path),include_font_metadata=True)[0]
                self.assertEqual([{k:v for k,v in c.items() if k!='fontMetadata'} for c in annotated],chars)
                self.assertEqual([c['fontMetadata']['declaredSize'] for c in annotated],[9.96,9.96])
                self.assertEqual([c['fontMetadata']['horizontalScaling'] for c in annotated],[.8,.8])
                self.assertEqual([c['fontMetadata']['name'] for c in annotated],['Fixture','Fixture'])
                self.assertEqual(''.join(c['text'] for c in chars),expected)
                self.assertAlmostEqual(chars[0]['x'],20)
                # (600/1000 * 9.96 + 1 + 25/1000 * 9.96) * 0.8
                self.assertAlmostEqual(chars[1]['x'],25.78)
                self.assertEqual([c['y'] for c in chars],[50,50])

    def test_mixed_baselines_pair_atomically_without_reusing_native_glyphs(self):
        chars=glyphs('A',20,50)+glyphs('b',26,47)
        line=dict(page=1,chars=chars)
        native=glyphs('A',20,50,0)+glyphs('b',26,47,1)
        result=compare([line,line],[native])
        self.assertEqual(result['matchedLines'],1);self.assertEqual(result['matchedChars'],2)
        self.assertEqual(result['unmatchedLines'],1);self.assertEqual(result['nativeUnused'],0)
        # A failed span cannot consume the matching A for the next valid line.
        wrong=dict(page=1,chars=glyphs('A',20,50)+glyphs('B',26,47))
        result=compare([wrong,line],[native]);self.assertEqual(result['matchedLines'],1)
        self.assertEqual(result['matches'][0]['unknownChars'],0)

    def test_metadata_reader_uses_declared_identity_width_and_rise_without_font_programs(self):
        from pdfminer.pdftypes import PDFStream
        original=PDFStream.get_data
        def guarded(stream):
            if stream.attrs.get('FixtureForbidden'):
                raise AssertionError('Embedded font program was decoded')
            return original(stream)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'metadata.pdf';path.write_bytes(metadata_pdf())
            with patch.object(PDFStream,'get_data',guarded):
                chars=read_metadata_chars(str(path))[0]
                annotated=read_metadata_chars(str(path),include_font_metadata=True)[0]
            self.assertEqual([{k:v for k,v in c.items() if k!='fontMetadata'} for c in annotated],chars)
            self.assertEqual([c['fontMetadata']['declaredSize'] for c in annotated],[10,10])
            self.assertTrue(all(c['fontMetadata']['horizontalScaling']==1 for c in annotated))
            path.write_bytes(metadata_pdf(to_unicode=False))
            with patch.object(PDFStream,'get_data',guarded), self.assertRaisesRegex(ValueError,'requires explicit ToUnicode'):
                read_metadata_chars(str(path))
        self.assertEqual([(c['text'],c['x'],c['y']) for c in chars],[('A',20,50),('b',26,47)])

    def test_shear_is_horizontal_but_quarter_rotation_is_not(self):
        self.assertTrue(horizontal_matrix(SimpleNamespace(a=1,b=0,c=.3333,d=1)))
        self.assertFalse(horizontal_matrix(SimpleNamespace(a=0,b=1,c=-1,d=0)))

    def test_split_strings_and_repeated_columns_are_paired_once(self):
        # Source run/string boundaries are irrelevant once native origins are
        # read; the same phrase in two columns must not share glyphs.
        page=glyphs('ABC',20,50)+glyphs('ABC',220,50,10)
        lines=[dict(page=1,chars=glyphs('ABC',220.1,50.1)),dict(page=1,chars=glyphs('ABC',20.1,50.1))]
        result=compare(lines,[page]);self.assertEqual(result['matchedChars'],6)
        self.assertEqual(result['nativeUnused'],0);self.assertAlmostEqual(result['maxX'],.1)
        result=compare(lines+[lines[0]],[page]);self.assertEqual(result['unmatchedLines'],1)

    def test_unknown_glyph_is_explicit_and_never_becomes_verified_text(self):
        source=[dict(page=1,chars=glyphs('A-',20,50))];native=[glyphs('A\x02',20,50)]
        self.assertEqual(compare(source,native)['unmatchedLines'],1)
        result=compare(source,native,allow_unknown=True)
        self.assertEqual(result['unknownChars'],1)
        self.assertFalse(result['matches'][0]['errors'][1]['unicodeVerified'])
        self.assertEqual(result['matches'][0]['errors'][1]['nativeText'],'\x02')
        self.assertEqual(compare([dict(page=1,chars=glyphs('AB',20,50))],[glyphs('\x02\x02',20,50)],allow_unknown=True)['unmatchedLines'],1)

    def test_text_or_geometry_mismatch_is_not_normalized_away(self):
        source=[dict(page=1,chars=glyphs('ABC',20,50))]
        for native in (glyphs('ABD',20,50),glyphs('ABC',100,50),glyphs('ABC',20,60)):
            self.assertEqual(compare(source,[native])['unmatchedLines'],1)
        self.assertEqual(compare(source,[glyphs('A\x02C',20,50)])['unmatchedLines'],1)

    def test_equal_distance_alternatives_remain_ambiguous(self):
        source=[dict(page=1,chars=glyphs('AB',20,50))]
        result=compare(source,[glyphs('AB',20,49,0)+glyphs('AB',20,51,10)])
        self.assertEqual(result['unmatched'][0]['reason'],'ambiguous')

    def test_native_origins_agree_with_existing_independent_word_reference(self):
        try:import pypdfium2
        except ImportError:self.skipTest('Optional permissively licensed PDFium runtime is unavailable.')
        root=Path(__file__).resolve().parent/'fixtures/row-border-insets'
        reference=json.loads((root/'positions.json').read_text())['row-border-insets']
        lines=[dict(page=r['page']+1,chars=[dict(text=r['text'][0],x=r['x'],y=r['y'])]) for r in reference]
        result=compare(lines,read_chars(str(root/'row-border-insets-native.pdf')))
        self.assertEqual(result['matchedLines'],30)
        self.assertLess(result['maxX'],.001);self.assertLess(result['maxY'],.001)
        metadata=compare(lines,read_metadata_chars(str(root/'row-border-insets-native.pdf')))
        self.assertEqual(metadata['matchedLines'],30)
        self.assertLess(metadata['maxX'],.001);self.assertLess(metadata['maxY'],.001)


if __name__=='__main__':unittest.main()
