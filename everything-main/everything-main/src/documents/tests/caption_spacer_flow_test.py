from pathlib import Path
import json
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from caption_row_flow_fixture import generate
from record_caption_spacer_flow import FOLDER, record


class CaptionSpacerFlow(unittest.TestCase):
    def test_suppressed_styled_bottom_edge_changes_native_flow(self):
        native = record()
        self.assertEqual(native, json.loads((FOLDER / 'native-reference.json').read_text()))
        self.assertEqual([c['captionToLabelLogical'] for c in native['cases']], [382, 382, 378, 378, 378, 378])
        self.assertEqual([c['mergedSpacer'] for c in native['cases']], [True, False, True, False, True, False])

    def test_original_source_regenerates_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); generate(folder)
            for name in ('control.docx', 'cases.json'):
                self.assertEqual((folder / name).read_bytes(), (FOLDER / name).read_bytes())


if __name__ == '__main__':
    unittest.main()
