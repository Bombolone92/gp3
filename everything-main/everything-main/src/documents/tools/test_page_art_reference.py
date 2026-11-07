import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('page_art', Path(__file__).with_name('inspect_page_art_reference.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PageArtReferenceTest(unittest.TestCase):
    def inspect(self, operations):
        page = SimpleNamespace(mediabox=[0, 0, 300, 220], get_contents=lambda: SimpleNamespace(operations=operations))
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'reference.pdf'
            source.write_bytes(b'independent parser input')
            with patch.object(module, 'PdfReader', return_value=SimpleNamespace(pages=[page]*6)):
                return module.inspect(source)['pages'][0]['paths']

    def test_transform_is_applied_to_graphical_bounds(self):
        paths = self.inspect([([2, 0, 0, 3, 10, 20], b'cm'), ([1, 2], b'm'), ([4, 5], b'l'), ([], b'h'), ([], b'f*')])
        self.assertEqual(paths[0]['boundsPt'], [12, 26, 18, 35])

    def test_equal_shapes_with_different_clips_do_not_compare_equal(self):
        shape = [([1, 2], b'm'), ([4, 5], b'l'), ([], b'h'), ([], b'f*')]
        first = self.inspect([([0, 0, 10, 10], b're'), ([], b'W*'), ([], b'n')]+shape)
        second = self.inspect([([0, 0, 20, 20], b're'), ([], b'W*'), ([], b'n')]+shape)
        self.assertEqual(first[0]['sha256'], second[0]['sha256'])
        self.assertNotEqual(first[0]['clipSha256'], second[0]['clipSha256'])

    def test_unhandled_curves_fail_instead_of_claiming_equivalence(self):
        with self.assertRaisesRegex(ValueError, 'line-only'):
            self.inspect([([1, 2, 3, 4, 5, 6], b'c')])


if __name__ == '__main__':
    unittest.main()
