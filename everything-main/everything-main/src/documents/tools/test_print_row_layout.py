"""Preserve independently observed API precision and capture safety guards."""
import hashlib, json, os, subprocess, tempfile, unittest
from pathlib import Path
from check_print_row_layout import ROOT, analyze

class RowLayoutTests(unittest.TestCase):
    def test_reproduces_native_observations_and_precision_counterexample(self):
        actual = analyze()
        expected = json.loads((ROOT/'docs/evidence/print-row-api-precision-2026-10-10.json').read_bytes())
        self.assertEqual(actual,expected)
        self.assertEqual((actual['cases'],actual['directPointCastMismatches'],actual['floatFactorCastMismatches']),(80,0,20))
        wrong = [r for r in actual['rows'] if r['rowHeightPt']!=r['floatFactorCast']]
        self.assertTrue(all(r['heightTwips']==406 for r in wrong))
        self.assertEqual((wrong[0]['rowHeightPt'],wrong[0]['floatFactorCast']),
            (20.299999237060547,20.30000114440918))

    def test_range_positions_have_coarser_precision_than_source_dimensions(self):
        actual = analyze()
        self.assertTrue(actual['observedPositionsOnThreeQuarterPtGrid'])
        self.assertEqual(actual['unavailablePositions'],[])
        self.assertEqual(actual['view'],dict(type=3,zoomPercent=75))
        self.assertEqual(actual['rows'][0]['topTwips']/20,35.95)
        self.assertEqual(actual['rows'][0]['rangePageYPt'],36)
        self.assertNotEqual(actual['rows'][0]['rangePageYPt'],actual['rows'][0]['topTwips']/20)

    @unittest.skipUnless(os.name=='nt','Windows native capture guards')
    def test_wrong_hash_occupied_destination_and_wrong_dimensions_fail_before_word_lookup(self):
        source=ROOT/'tests/fixtures/print-coordinate-phase/control.docx'
        cases=ROOT/'tests/fixtures/print-coordinate-phase/cases.json'
        digest=hashlib.sha256(source.read_bytes()).hexdigest()
        script=ROOT/'tools/capture_print_row_layout.ps1'
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch);occupied=root/'occupied';occupied.mkdir()
            sentinel=occupied/'keep.txt';sentinel.write_bytes(b'preserve capture')
            changed=root/'wrong-cases.json';data=json.loads(cases.read_bytes());data[0]['heightTwips']+=1
            changed.write_text(json.dumps(data))
            for output,casepath,expected,message in [
                (root/'wrong-hash',cases,'0'*64,'Wrong source bytes'),
                (occupied,cases,digest,'Use a fresh capture directory'),
                (root/'wrong-dimensions',changed,digest,'Wrong authored row dimensions')]:
                with self.subTest(message=message):
                    result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(script),
                        '-Source',str(source),'-Cases',str(casepath),'-OutputRoot',str(output),'-ExpectedSha256',expected],
                        capture_output=True,text=True,timeout=30)
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn(message,result.stdout+result.stderr)
                    if output!=occupied:self.assertFalse(output.exists())
            self.assertEqual(sentinel.read_bytes(),b'preserve capture')
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),digest)

if __name__ == '__main__':unittest.main()
