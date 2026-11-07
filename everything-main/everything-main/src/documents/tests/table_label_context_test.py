"""Native context isolation and reproducible source; not corpus parity proof."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from record_table_label_context import FOLDER, record
from table_label_context_fixture import generate


class TableLabelContext(unittest.TestCase):
    def test_native_context_does_not_change_border_relative_baseline(self):
        result = record()
        self.assertEqual(result, json.loads((FOLDER / 'native-reference.json').read_text()))
        self.assertEqual([c['baselineFromTopBorderLogical'] for c in result['cases']], [142] * 6)
        self.assertEqual([c['logicalOrigin'][1] for c in result['cases']], [144] * 4 + [292] * 2)
        self.assertEqual([c['height'] for c in result['cases']], ['exact'] + ['atLeast'] * 5)
        self.assertEqual([c['nested'] for c in result['cases']], [False] * 4 + [True] * 2)

    def test_source_is_reproducible_without_word_or_font_programs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            generate(root)
            for name in ['control.docx', 'cases.json']:
                self.assertEqual((root / name).read_bytes(), (FOLDER / name).read_bytes())


if __name__ == '__main__':
    unittest.main()
