import unittest
from check_theme_chroma_stages import convert, evidence, ROOT
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path


class ChromaStageTests(unittest.TestCase):
    def test_exact_quantization_transition_is_not_a_float_artifact(self):
        self.assertEqual(convert('7F8080', 'shade', 84), [42,42,42])
        self.assertEqual(convert('7F8080', 'shade', 86), [42,43,43])
        self.assertEqual(convert('80817F', 'shade', 44), [21,22,21])
        self.assertEqual(convert('80817F', 'shade', 128), [64,64,63])

    def test_gray_uses_exact_byte_truncation(self):
        self.assertEqual(convert('808080', 'shade', 128), [64,64,64])
        self.assertEqual(convert('808080', 'tint', 128), [191,191,191])
        self.assertEqual(convert('4F81BD', 'tint', 255), [79,129,189])

    def test_complete_native_sets_reject_generalizing_the_near_gray_match(self):
        data = evidence()
        self.assertEqual(data['totalCases'], 2176)
        by_set = {r['set']:r for r in data['results']}
        near = by_set['theme-low-chroma-sweep']['models']
        self.assertEqual([r['matches'] for r in near], [429,512,469])
        shade = by_set['theme-shade-sweep']['models'][1]
        self.assertEqual(shade['matches'], 387)
        self.assertEqual(shade['firstFailure'], dict(label='C008', base='4F81BD',
            theme='accent1', mode='shade', value=8, actual=[2,4,6], native=[2,3,6]))
        mid = by_set['theme-chroma-midtones']['models'][1]
        self.assertEqual(mid['matches'], 452)
        self.assertEqual(mid['firstFailure'], dict(label='C085', base='202121',
            theme='accent1', mode='shade', value=85, actual=[10,11,11], native=[10,10,10]))

    def test_new_native_control_is_reproducible_from_independent_source(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run([sys.executable, str(ROOT/'tools/theme_color_precision_fixture.py'),
                '--bases','202121','DFE0DE','101112','EDEEEF','202222','DCDDDF','0F1010','EFF0EE',
                '--full-shades','--output-dir',folder], check=True, capture_output=True)
            for filename in ['control.docx','cases.json']:
                self.assertEqual(hashlib.sha256((Path(folder)/filename).read_bytes()).hexdigest(),
                    hashlib.sha256((ROOT/'tests/fixtures/theme-chroma-midtones'/filename).read_bytes()).hexdigest())

    def test_invalid_modes_and_parameters_are_not_silently_accepted(self):
        for args in [('808080','other',128),('808080','shade',256),('808080','tint',128,0)]:
            with self.assertRaises(ValueError): convert(*args)


if __name__ == '__main__': unittest.main()
