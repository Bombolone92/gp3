"""Synthetic PDF parser checks; these are not native reference evidence."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DecodedStreamObject


class RectangleRecordingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        tools = self.root / 'tools'
        tools.mkdir()
        self.recorder = tools / 'record_print_section_phase.py'
        shutil.copyfile(Path(__file__).with_name(self.recorder.name), self.recorder)
        self.folder = self.root / 'tests/fixtures/print-paper-phase'
        self.folder.mkdir(parents=True)
        self.source = self.folder / 'control.docx'
        with ZipFile(self.source, 'w') as package:
            package.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
        self.sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        (self.folder / 'cases.json').write_text(json.dumps([{'page': 0}]))
        self.rectangles = '0.427 0.498 0.569 rg\n' + '\n'.join(
            f'{x} {y} {w} {h} re f*' for x, y, w, h in
            [(36, 755, 216, 1), (36, 734, 216, 1),
             (36, 735, 1, 20), (251, 735, 1, 20)] + [(36, 755, 1, 1)] * 8)

    def record(self, stream):
        writer = PdfWriter()
        page = writer.add_blank_page(width=612, height=792)
        content = DecodedStreamObject()
        content.set_data(stream.encode('ascii'))
        page.replace_contents(content)
        writer.add_metadata({'/Producer': 'Microsoft synthetic parser test'})
        pdf = self.root / 'synthetic.pdf'
        with pdf.open('wb') as target:
            writer.write(target)
        return subprocess.run([sys.executable, str(self.recorder), 'paper',
            str(pdf), str(self.source), '--source-sha256', self.sha],
            capture_output=True, text=True)

    def test_unclipped_rectangles_record(self):
        result = self.record(self.rectangles)
        self.assertEqual(result.returncode, 0, result.stderr)
        reference = json.loads((self.folder / 'native-print-frames.json').read_bytes())
        self.assertEqual(reference['frames'][0]['boundsPt'], [36, 36, 252, 58])

    def test_restored_content_clip_does_not_affect_later_borders(self):
        result = self.record('q 0 0 1 1 re W* n BT ET Q\n' + self.rectangles)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_active_rectangle_clip_rejected(self):
        result = self.record('0 0 1 1 re W* n\n' + self.rectangles)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Clipped border', result.stderr)
        self.assertFalse((self.folder / 'native.pdf').exists())

    def test_clipped_border_rejected_even_when_contained(self):
        result = self.record('0 0 612 792 re W n\n' + self.rectangles)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Clipped border', result.stderr)

    def test_nonrectangle_clip_rejected(self):
        result = self.record('0 0 m 1 0 l 1 1 l h W n\n' + self.rectangles)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Nonrectangle clipping', result.stderr)

    def test_outer_clip_survives_nested_restore(self):
        result = self.record('0 0 1 1 re W n q Q\n' + self.rectangles)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Clipped border', result.stderr)

    def test_shading_clip_preserved(self):
        result = self.record('q 0 0 1 1 re W n 1 1 1 rg 0 0 10 10 re f Q\n' + self.rectangles)
        self.assertEqual(result.returncode, 0, result.stderr)
        pdf=PdfReader(self.folder/'native.pdf')
        operations=ContentStream(pdf.pages[0].get_contents(),pdf).operations
        self.assertEqual(operations[:3], [([],b'q'),([0,0,1,1],b're'),([],b'W')])
        self.assertIn(([0,0,10,10],b're'), operations)
        self.assertIn(([],b'Q'), operations)


if __name__ == '__main__':
    unittest.main()
