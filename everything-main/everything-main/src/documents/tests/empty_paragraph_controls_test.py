"""Negative native controls prevent unjustified paragraph-metric corrections."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from record_empty_paragraph_controls import ROOT, record
from empty_paragraph_script_size_fixture import generate as script_fixture
from empty_paragraph_spacing_fixture import generate as spacing_fixture


class EmptyParagraphControls(unittest.TestCase):
    def test_complex_script_size_does_not_change_latin_prefix_geometry(self):
        folder = ROOT / 'empty-paragraph-script-size'
        result = record(folder)
        self.assertEqual(result, json.loads((folder / 'native-reference.json').read_text()))
        self.assertEqual([c['prefix']['logicalOrigin'] for c in result['cases']], [[60, 141]] * 6)
        self.assertEqual([c['logicalOrigin'] for c in result['cases']], [[151, 304]] * 6)
        self.assertEqual([c['baselineFromTopBorderLogical'] for c in result['cases']], [142] * 6)

    def test_explicit_line_and_style_inheritance_preserve_geometry(self):
        folder = ROOT / 'empty-paragraph-spacing'
        result = record(folder)
        self.assertEqual(result, json.loads((folder / 'native-reference.json').read_text()))
        self.assertEqual([c['prefix']['logicalOrigin'] for c in result['cases']], [[60, 141]] * 4 + [[60, 145]] * 2)
        self.assertEqual([c['logicalOrigin'] for c in result['cases']], [[151, 304]] * 4 + [[151, 309]] * 2)
        self.assertEqual([c['baselineFromTopBorderLogical'] for c in result['cases']], [142] * 4 + [143] * 2)

    def test_both_sources_reproduce_without_word_or_font_programs(self):
        for name, generate in [('empty-paragraph-script-size', script_fixture), ('empty-paragraph-spacing', spacing_fixture)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory); generate(folder)
                for filename in ('control.docx', 'cases.json'):
                    self.assertEqual((folder / filename).read_bytes(), (ROOT / name / filename).read_bytes())


if __name__ == '__main__':
    unittest.main()
