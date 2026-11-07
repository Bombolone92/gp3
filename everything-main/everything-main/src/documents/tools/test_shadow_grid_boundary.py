"""Source reproducibility and native-evidence input/output protection controls."""
from pathlib import Path
from zipfile import ZipFile
import contextlib
import copy
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from lxml import etree
import shadow_grid_boundary_fixture as fixture
import record_shadow_grid_boundary as recorder


@contextlib.contextmanager
def owned_temp(prefix):
    path = Path(tempfile.mkdtemp(prefix=prefix)).resolve()
    root = Path(tempfile.gettempdir()).resolve()
    try:
        yield str(path)
    finally:
        if path.parent != root or not path.name.startswith(prefix) or not prefix.startswith('shadow-grid-'):
            raise RuntimeError('Refusing recursive cleanup outside the owned temporary directory')
        shutil.rmtree(path)


class ShadowGridControls(unittest.TestCase):
    def test_source_reproduces_and_has_no_text_or_font_programs(self):
        with owned_temp('shadow-grid-source-') as name:
            folder = Path(name) / 'control'
            with contextlib.redirect_stdout(io.StringIO()):
                fixture.build(folder)
            self.assertEqual((folder / 'source.docx').read_bytes(), (recorder.FIXTURE / 'source.docx').read_bytes())
            self.assertEqual((folder / 'cases.json').read_bytes(), (recorder.FIXTURE / 'cases.json').read_bytes())
            with ZipFile(folder / 'source.docx') as z:
                tree = etree.fromstring(z.read('word/document.xml'))
                self.assertEqual(len(list(tree.iter(f'{{{fixture.W}}}t'))), 0)
                self.assertEqual(len(list(tree.iter(f'{{{fixture.WP}}}anchor'))), 16)
                self.assertEqual(len(list(tree.iter(f'{{{fixture.W}}}pageBreakBefore'))), 15)
                self.assertFalse(any(p.startswith('word/fonts/') for p in z.namelist()))

    def test_generator_refuses_occupied_destination(self):
        with owned_temp('shadow-grid-occupied-') as name:
            sentinel = Path(name) / 'source.docx'
            sentinel.write_bytes(b'owned independent sentinel')
            with self.assertRaisesRegex(ValueError, 'fresh or empty'):
                fixture.build(name)
            self.assertEqual(sentinel.read_bytes(), b'owned independent sentinel')

    def test_recorder_rejects_changed_identity_before_metafile_reads(self):
        reference = json.loads((recorder.FIXTURE / 'native-metafile-grid.json').read_text())
        base = dict(sourceSha256=reference['sourceSha256'], casesSha256=reference['casesSha256'],
                    sourceUnchanged=True, savedBefore=False, savedAfter=False,
                    viewBefore=reference['viewBefore'], viewAfter=reference['viewAfter'], pages=16,
                    captures=[{}] * 16)
        for key, value, message in [('sourceSha256', '0' * 64, 'Source hash'),
                                    ('savedAfter', True, 'saved state'),
                                    ('pages', 15, 'Incomplete')]:
            with self.subTest(key=key), owned_temp('shadow-grid-invalid-') as name:
                data = copy.deepcopy(base); data[key] = value
                (Path(name) / 'capture.json').write_text(json.dumps(data))
                with patch.object(recorder, 'native_images', side_effect=AssertionError('premature metafile read')):
                    with self.assertRaisesRegex(ValueError, message):
                        recorder.record(name)

    def test_cli_refuses_to_overwrite_an_input(self):
        with owned_temp('shadow-grid-cli-') as name:
            path = Path(name) / 'capture.json'
            path.write_bytes(b'{"owned":true}')
            result = subprocess.run([sys.executable, str(fixture.ROOT / 'tools/record_shadow_grid_boundary.py'),
                                     name, '--output', str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('fresh report', result.stderr)
            self.assertEqual(path.read_bytes(), b'{"owned":true}')

    def test_capture_rejects_wrong_source_before_word_lookup(self):
        with owned_temp('shadow-grid-capture-hash-') as name:
            result = self.capture_guard(Path(name) / 'fresh', '0' * 64)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Wrong source bytes', result.stderr)
            self.assertFalse((Path(name) / 'fresh').exists())

    def test_capture_preserves_an_occupied_destination(self):
        with owned_temp('shadow-grid-capture-occupied-') as name:
            sentinel = Path(name) / 'capture.json'
            sentinel.write_bytes(b'{"owned":true}')
            result = self.capture_guard(Path(name), recorder.sha(recorder.FIXTURE / 'source.docx'))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('fresh capture directory', result.stderr)
            self.assertEqual(sentinel.read_bytes(), b'{"owned":true}')

    @staticmethod
    def capture_guard(output, source_hash):
        return subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                               str(fixture.ROOT / 'tools/capture_shadow_grid_boundary.ps1'),
                               '-Source', str(recorder.FIXTURE / 'source.docx'),
                               '-Cases', str(recorder.FIXTURE / 'cases.json'),
                               '-OutputRoot', str(output), '-ExpectedSha256', source_hash],
                              capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main()
