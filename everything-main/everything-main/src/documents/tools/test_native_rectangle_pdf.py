"""Authored synthetic inputs: resource omission and retained rectangle clips."""
from pathlib import Path
import tempfile,unittest
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DecodedStreamObject,DictionaryObject,NameObject,FloatObject
from native_rectangle_pdf import rectangle_fills,reconstruct_rectangle_pdf

class RectanglePdfTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source.pdf';self.output=self.root/'geometry.pdf'
    def source_pdf(self,operations,with_font=False,state_alpha=None):
        writer=PdfWriter();page=writer.add_blank_page(width=612,height=792)
        stream=DecodedStreamObject();stream.set_data(operations.encode('ascii'));page.replace_contents(stream)
        if with_font:
            program=DecodedStreamObject();program.set_data(b'authored synthetic unused font resource')
            descriptor=DictionaryObject({NameObject('/FontFile2'):writer._add_object(program)})
            font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/TrueType'),NameObject('/BaseFont'):NameObject('/Synthetic'),NameObject('/FontDescriptor'):writer._add_object(descriptor)})
            page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        if state_alpha is not None:
            state=DictionaryObject({NameObject('/Type'):NameObject('/ExtGState'),NameObject('/BM'):NameObject('/Normal'),NameObject('/ca'):FloatObject(state_alpha)})
            page['/Resources'][NameObject('/ExtGState')]=DictionaryObject({NameObject('/SyntheticAlpha'):writer._add_object(state)})
        with self.source.open('wb') as target:writer.write(target)
    def test_font_resource_and_empty_text_are_not_copied(self):
        self.source_pdf('0.427 0.498 0.569 rg 36 750 216 .96 re f* BT /F1 8 Tf () Tj ET',True)
        original=self.source.read_bytes()
        reconstruct_rectangle_pdf(self.source,self.output,[1])
        self.assertEqual(original,self.source.read_bytes())
        clean=PdfReader(self.output);self.assertFalse(clean.pages[0]['/Resources'].get('/Font'))
        self.assertNotIn(b'authored synthetic unused font resource',self.output.read_bytes())
        before=PdfReader(self.source)
        self.assertEqual(rectangle_fills(before.pages[0],before),rectangle_fills(clean.pages[0],clean))
    def test_nested_gray_clip_and_unclipped_border_are_preserved(self):
        self.source_pdf('q 0 0 10 10 re W n q 1 1 8 8 re W n 1 g 0 0 30 30 re f Q Q 0.427 0.498 0.569 rg 36 750 216 .96 re f*')
        reconstruct_rectangle_pdf(self.source,self.output,[1])
        clean=PdfReader(self.output);fills=rectangle_fills(clean.pages[0],clean)
        self.assertEqual(fills[0][2],[[0,0,10,10],[1,1,8,8]])
        self.assertEqual(fills[1][2],[])
    def test_clipped_blue_border_is_rejected_before_output(self):
        self.source_pdf('0 0 612 792 re W n 0.427 0.498 0.569 rg 36 750 216 .96 re f*')
        with self.assertRaisesRegex(AssertionError,'Clipped border'):reconstruct_rectangle_pdf(self.source,self.output,[1])
        self.assertFalse(self.output.exists())
    def test_nonrectangle_fill_and_transform_are_rejected(self):
        blue='0.427 0.498 0.569 rg 36 750 216 .96 re f*'
        for operations in ['1 0 0 rg 0 0 m 10 0 l 5 10 l h f','1 0 0 rg 0 0 m 10 0 l 5 10 l h f '+blue,'1 0 0 1 0 0 cm '+blue,'/SyntheticAlpha gs '+blue,'1 0 0 rg 0 0 10 10 re 1 1 2 2 re f '+blue]:
            with self.subTest(operations=operations):
                self.source_pdf(operations)
                with self.assertRaises(AssertionError):reconstruct_rectangle_pdf(self.source,self.output,[1])
                self.assertFalse(self.output.exists())
    def test_wrong_counts_and_same_source_target_are_rejected(self):
        self.source_pdf('0.427 0.498 0.569 rg 36 750 216 .96 re f*')
        with self.assertRaisesRegex(AssertionError,'count'):reconstruct_rectangle_pdf(self.source,self.output,[12])
        with self.assertRaisesRegex(AssertionError,'separate'):reconstruct_rectangle_pdf(self.source,self.source,[1])
        with self.assertRaisesRegex(AssertionError,'positive integers'):reconstruct_rectangle_pdf(self.source,self.output,[True])
        self.assertFalse(self.output.exists())
    def test_neutral_state_is_validated_and_nonopaque_state_does_not_replace_output(self):
        operations='/SyntheticAlpha gs 0.427 0.498 0.569 rg 36 750 216 .96 re f*'
        self.source_pdf(operations,state_alpha=1)
        reconstruct_rectangle_pdf(self.source,self.output,[1])
        clean=PdfReader(self.output);self.assertFalse(clean.pages[0]['/Resources'].get('/ExtGState'))
        original=self.output.read_bytes()
        self.source_pdf(operations,state_alpha=.5)
        with self.assertRaisesRegex(AssertionError,'opacity'):reconstruct_rectangle_pdf(self.source,self.output,[1])
        self.assertEqual(self.output.read_bytes(),original)

if __name__=='__main__':unittest.main()
