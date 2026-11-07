"""Reproduce original compound controls and independently re-read native origins."""
from pathlib import Path
import json, struct, subprocess, sys, tempfile, unittest
from record_script_position_metafiles import capture, sha

ROOT = Path(__file__).resolve().parents[1]


class PositionControlsTests(unittest.TestCase):
    def test_compound_hashes_and_native_rounding_order(self):
        folder = ROOT/'tests/fixtures/script-compound-position'
        reference = json.loads((folder/'reference.json').read_text())
        for name, digest in reference['hashes'].items():
            self.assertEqual(sha((folder/name).read_bytes()), digest)
        self.assertEqual(reference['baseFontSha256'], sha((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes()))
        provenance = json.loads((folder/'native-capture.json').read_text(encoding='utf-8-sig'))
        self.assertTrue(provenance['readOnly']); self.assertTrue(provenance['sourceUnchanged'])
        self.assertEqual(provenance['sourceSha256'], reference['hashes']['controls.docx'])
        case = json.loads((folder/'cases.json').read_text())[0]
        native, _ = capture((folder/'native-font-1.emf').read_bytes(), case, quantized_frame=True)
        self.assertEqual(native['rows'], reference['cases'][0]['rows'])
        self.assertEqual([r['scriptHeight'] for r in native['rows']], [-67, -58, -54, -46, -108, -100, -88, -79])
        self.assertEqual([r['risePt'] for r in native['rows']], [3.96, -.96, 3.96, -.96, 6.48, -1.56, 6.48, -1.56])

    def test_generator_reproduces_original_compound_source(self):
        folder = ROOT/'tests/fixtures/script-compound-position'
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run([sys.executable, str(ROOT/'tools/script_compound_position_fixture.py'), '--output', temporary], check=True, capture_output=True)
            for name in ['controls.docx', 'cases.json', 'fonts.json', 'OFL.txt', *json.loads((folder/'fonts.json').read_text())]:
                self.assertEqual((Path(temporary)/name).read_bytes(), (folder/name).read_bytes(), name)

    def test_rejects_changed_native_vertical_frame(self):
        folder = ROOT/'tests/fixtures/script-compound-position'
        case = json.loads((folder/'cases.json').read_text())[0]
        data = bytearray((folder/'native-font-1.emf').read_bytes())
        struct.pack_into('<i', data, 32, struct.unpack_from('<i', data, 32)[0]+100)
        with self.assertRaises(AssertionError): capture(data, case, quantized_frame=True)

    def test_bundled_native_vertical_origins(self):
        folder = ROOT/'tests/fixtures/bundled-script'
        reference = json.loads((folder/'position-reference.json').read_text())
        self.assertEqual(sha((folder/'control.docx').read_bytes()), reference['sourceSha256'])
        self.assertEqual(sha((folder/'cases.json').read_bytes()), reference['casesSha256'])
        count = 0
        for case, expected in zip(json.loads((folder/'cases.json').read_text()), reference['cases'], strict=True):
            data = (folder/expected['metafile']).read_bytes()
            self.assertEqual(sha(data), expected['metafileSha256'])
            self.assertEqual(sha((ROOT/'public/fonts'/expected['font']).read_bytes()), expected['fontSha256'])
            actual, _ = capture(data, case, quantized_frame=True)
            self.assertEqual(actual['rows'], expected['rows']); count += len(actual['rows'])
        self.assertEqual(count, 36)


if __name__ == '__main__': unittest.main()
