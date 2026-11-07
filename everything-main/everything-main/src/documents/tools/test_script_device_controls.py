"""Integrity, regeneration and rejection checks for native device controls."""
from pathlib import Path
import json, struct, subprocess, sys, tempfile, unittest
from record_script_device_controls import ROOT, FOLDERS, verify_source
from record_script_position_metafiles import capture, sha


class DeviceControlsTests(unittest.TestCase):
    def test_hash_bindings_and_274_native_rows(self):
        total = 0
        for name in FOLDERS:
            folder = ROOT/'tests/fixtures'/name
            cases = json.loads((folder/'cases.json').read_text())
            reference = json.loads((folder/'reference.json').read_text())
            for filename, digest in reference['hashes'].items(): self.assertEqual(sha((folder/filename).read_bytes()), digest)
            self.assertEqual(reference['baseFontSha256'], sha((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes()))
            provenance = json.loads((folder/'native-capture.json').read_text(encoding='utf-8-sig'))
            self.assertTrue(provenance['sourceUnchanged']); self.assertTrue(provenance['readOnly'])
            self.assertEqual(provenance['referenceBuild'], reference['referenceBuild'])
            for index, (case, expected) in enumerate(zip(cases, reference['cases'], strict=True), 1):
                data = (folder/f'native-font-{index}.emf').read_bytes()
                self.assertEqual(sha(data), provenance['captures'][f'native-font-{index}.emf'])
                native, _ = capture(data, case, quantized_frame=True,
                                    zero_subscript_offset=name == 'script-sub-offset' and case['subOffsetMetric'] == 0)
                self.assertEqual(native['rows'], expected['rows'])
                total += len(native['rows'])
        self.assertEqual(total, 274)

    def test_independent_font_and_source_structure_checks(self):
        for name in FOLDERS:
            folder = ROOT/'tests/fixtures'/name
            verify_source(folder, json.loads((folder/'cases.json').read_text()))

    def test_only_the_83_ppem_probe_changes_the_native_superscript(self):
        reference = json.loads((ROOT/'tests/fixtures/script-vdmx-ppem/reference.json').read_text())
        rows = reference['cases']; baseline = rows[0]['rows']
        self.assertEqual([r['risePt'] for r in baseline], [3.48, -1.56])
        for case in rows[1:]:
            if case['ppem'] == 83:
                self.assertEqual([r['risePt'] for r in case['rows']], [3.96, -1.56])
            else: self.assertEqual(case['rows'], baseline)
            self.assertEqual([(r['normalHeight'], r['scriptHeight']) for r in case['rows']], [(-83, -50), (-83, -50)])

    def test_native_ascent_bound_plateau(self):
        rows = json.loads((ROOT/'tests/fixtures/script-device-caps/reference.json').read_text())['cases']
        bounds = [c for c in rows if c['kind'] == 'ascentDelta']
        self.assertEqual([c['value'] for c in bounds], [0, 4, 8, 16, 32])
        self.assertEqual([c['rows'][0]['risePt'] for c in bounds], [3.48, 3.96, 3.96, 3.96, 3.96])
        self.assertEqual([c['rows'][1]['risePt'] for c in bounds], [-1.56]*5)

    def test_sizing_difference_with_large_subscript_offsets_is_retained(self):
        caps = json.loads((ROOT/'tests/fixtures/script-device-caps/reference.json').read_text())['cases']
        offsets = json.loads((ROOT/'tests/fixtures/script-size-offset/reference.json').read_text())['cases']
        for value, height in [(650, -108), (850, -142)]:
            high = next(c for c in caps if c.get('kind') == 'superSize' and c['value'] == value)
            low = next(c for c in offsets if c['sizeMetric'] == value and c['offsetMetric'] == 700)
            self.assertEqual(high['rows'][0]['scriptHeight'], -100)
            self.assertEqual(low['rows'][0]['scriptHeight'], height)
        self.assertEqual([c['rows'][0]['risePt'] for c in offsets if c['sizeMetric'] == 850 and c['offsetMetric'] >= 350], [6.0]*8)

    def test_invalid_native_mapping_is_still_rejected(self):
        folder = ROOT/'tests/fixtures/script-vdmx-ppem'
        case = json.loads((folder/'cases.json').read_text())[0]
        data = bytearray((folder/'native-font-1.emf').read_bytes())
        struct.pack_into('<i', data, 32, struct.unpack_from('<i', data, 32)[0]+100)
        with self.assertRaises(AssertionError): capture(data, case, quantized_frame=True)

    def test_zero_offset_requires_the_explicit_bounded_capture_option(self):
        folder = ROOT/'tests/fixtures/script-sub-offset'
        case = json.loads((folder/'cases.json').read_text())[0]
        data = (folder/'native-font-1.emf').read_bytes()
        with self.assertRaises(AssertionError): capture(data, case, quantized_frame=True)
        actual, _ = capture(data, case, quantized_frame=True, zero_subscript_offset=True)
        self.assertEqual(actual['rows'][1]['risePt'], 0)

    def test_fractional_sizes_and_both_script_directions_expose_the_boundary(self):
        rows = json.loads((ROOT/'tests/fixtures/script-sub-offset-threshold/reference.json').read_text())['cases']
        baseline = rows[0]['rows']
        for row in baseline:
            if row['size'] == 20: self.assertEqual(row['scriptHeight'], -108 if row['script'] == 'superscript' else -83)
            if row['size'] == 20.5: self.assertEqual(row['scriptHeight'], -104)
        for offset, size, heights in [(510,20,[-108,-83]), (520,20,[-100,-100]), (524,10,[-54,-42]), (525,10,[-50,-50])]:
            case = next(c for c in rows if c['subOffsetMetric'] == offset)
            self.assertEqual([r['scriptHeight'] for r in case['rows'] if r['size'] == size], heights)

    def test_generators_reproduce_every_original_input(self):
        generators = ['script_vdmx_ppem_fixture.py', 'script_device_caps_fixture.py', 'script_size_offset_fixture.py', 'script_sub_offset_fixture.py', 'script_sub_threshold_fixture.py']
        with tempfile.TemporaryDirectory() as temporary:
            for name, generator in zip(FOLDERS, generators, strict=True):
                target = Path(temporary)/name
                subprocess.run([sys.executable, str(ROOT/'tools'/generator), '--output', str(target)], check=True, capture_output=True)
                source = ROOT/'tests/fixtures'/name
                files = ['controls.docx', 'cases.json', 'fonts.json', 'OFL.txt', *json.loads((source/'fonts.json').read_text())]
                for file in files: self.assertEqual((target/file).read_bytes(), (source/file).read_bytes(), file)


if __name__ == '__main__': unittest.main()
