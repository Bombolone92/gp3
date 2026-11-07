"""Integrity and rejection checks for independent native VDMX evidence."""
import io
import json
import struct
import unittest
from fontTools.ttLib import TTFont
from record_script_position_metafiles import capture, sha
from script_vdmx_fixture import TARGET, tables


class VdmxEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads((TARGET/'cases.json').read_text())
        self.reference = json.loads((TARGET/'reference.json').read_text())

    def test_all_native_inputs_and_48_rows_match_reference(self):
        for name, digest in self.reference['hashes'].items():
            self.assertEqual(sha((TARGET/name).read_bytes()), digest)
        self.assertEqual(sum(len(c['rows']) for c in self.cases), 48)
        for index, (case, expected) in enumerate(zip(self.cases, self.reference['cases']), 1):
            actual, _ = capture((TARGET/f'native-font-{index}.emf').read_bytes(), case, quantized_frame=True)
            self.assertEqual(actual['rows'], expected['rows'])

    def test_independent_decoder_confirms_only_device_bounds_vary(self):
        absent = tables((TARGET/'ScriptVDMXAbsent.ttf').read_bytes())
        for name, ascent, descent in [('Linear', .95, .35), ('Tall', 1.35, .35), ('Deep', .95, .75)]:
            data = (TARGET/f'ScriptVDMX{name}.ttf').read_bytes()
            t = tables(data)
            for tag in absent:
                if tag not in [b'head', b'name']: self.assertEqual(t[tag], absent[tag], tag)
            with TTFont(io.BytesIO(data)) as font:
                v = font['VDMX']
                self.assertEqual(v.version, 1)
                self.assertEqual(v.ratRanges, [dict(bCharSet=1, xRatio=0, yStartRatio=0, yEndRatio=0, groupIndex=0)])
                self.assertEqual(len(v.groups), 1)
                self.assertEqual(len(v.groups[0]), 255)
                import math
                for ppem, bounds in v.groups[0].items():
                    self.assertEqual(bounds, (math.ceil(ascent*ppem), -math.ceil(descent*ppem)))

    def test_size_and_opposite_script_direction_are_unchanged(self):
        variants = {v: [r for c in self.reference['cases'] if c['variant']==v for r in c['rows']]
                    for v in ['Absent', 'Linear', 'Tall', 'Deep']}
        base = variants['Absent']
        for rows in variants.values():
            self.assertEqual([(r['normalHeight'], r['scriptHeight']) for r in rows],
                             [(r['normalHeight'], r['scriptHeight']) for r in base])
        self.assertEqual(variants['Linear'], base)
        for name, unchanged in [('Tall', 'subscript'), ('Deep', 'superscript')]:
            self.assertEqual([r for r in variants[name] if r['script']==unchanged],
                             [r for r in base if r['script']==unchanged])
            self.assertTrue(any(a['riseLogical']!=b['riseLogical'] for a,b in zip(variants[name], base)))

    def test_bad_frame_mapping_is_rejected_without_changing_old_bound(self):
        data = (TARGET/'native-font-1.emf').read_bytes(); case = self.cases[0]
        with self.assertRaises(AssertionError): capture(data, case)
        capture(data, case, quantized_frame=True)
        bad = bytearray(data)
        struct.pack_into('<i', bad, 36, struct.unpack_from('<i', data, 36)[0]+4)
        with self.assertRaises(AssertionError): capture(bad, case, quantized_frame=True)
        bad = bytearray(data)
        struct.pack_into('<i', bad, 32, struct.unpack_from('<i', data, 32)[0]+100)
        with self.assertRaises(AssertionError): capture(bad, case, quantized_frame=True)


if __name__ == '__main__': unittest.main()
