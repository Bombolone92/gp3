"""Preserve native references while independently reproducing authored controls."""
import hashlib,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
GENERATOR=ROOT/'tools/print_section_phase_fixture.py'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

class FixtureOutputTests(unittest.TestCase):
    def run_generator(self,kind,*arguments):
        return subprocess.run([sys.executable,str(GENERATOR),kind,*map(str,arguments)],capture_output=True,text=True)

    def test_default_captured_sources_remain_byte_identical(self):
        for kind in ['row-width','paper','high-row','paper-height','tie','story-margin','coordinate','coordinate-independent']:
            with self.subTest(kind=kind):
                folder=ROOT/f'tests/fixtures/print-{kind}-phase'
                before={p.name:sha(p) for p in folder.iterdir() if p.is_file()}
                result=self.run_generator(kind)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('fresh or empty directory',result.stderr)
                self.assertEqual(before,{p.name:sha(p) for p in folder.iterdir() if p.is_file()})

    def test_fresh_output_reproduces_capture_and_rejects_second_write(self):
        for kind in ['tie','story-margin','coordinate','coordinate-independent']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as scratch:
                target=Path(scratch)/'new control'
                result=self.run_generator(kind,'--output-folder',target)
                self.assertEqual(result.returncode,0,result.stderr)
                captured=ROOT/f'tests/fixtures/print-{kind}-phase'
                self.assertEqual((captured/'cases.json').read_bytes(),(target/'cases.json').read_bytes())
                with ZipFile(captured/'control.docx') as expected,ZipFile(target/'control.docx') as actual:
                    self.assertEqual(expected.namelist(),actual.namelist())
                    for name in expected.namelist():self.assertEqual(expected.read(name),actual.read(name),name)
                before={p.name:sha(p) for p in target.iterdir()}
                result=self.run_generator(kind,'--output-folder',target)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(before,{p.name:sha(p) for p in target.iterdir()})

    def test_empty_directory_is_allowed_but_files_and_unrelated_content_are_preserved(self):
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch);empty=root/'empty';empty.mkdir()
            result=self.run_generator('tie','--output-folder',empty)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(len(json.loads((empty/'cases.json').read_bytes())),8)
            file=root/'file';file.write_bytes(b'keep existing file')
            occupied=root/'occupied';occupied.mkdir();sentinel=occupied/'notes.txt';sentinel.write_bytes(b'keep existing notes')
            for target in [file,occupied]:
                result=self.run_generator('tie','--output-folder',target)
                self.assertNotEqual(result.returncode,0)
            self.assertEqual(file.read_bytes(),b'keep existing file')
            self.assertEqual(sentinel.read_bytes(),b'keep existing notes')
            self.assertEqual(list(occupied.iterdir()),[sentinel])

if __name__=='__main__':unittest.main()
