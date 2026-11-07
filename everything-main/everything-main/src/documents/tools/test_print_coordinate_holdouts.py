"""Verify independent controls and retain arithmetic counterexamples."""
import json, math, unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from check_print_coordinate_holdouts import ROOT, report, f32

class CoordinateHoldoutTests(unittest.TestCase):
    def test_native_provenance_and_reproducible_report(self):
        actual = report()
        expected = json.loads((ROOT/'docs/evidence/print-coordinate-holdouts-2026-10-10.json').read_bytes())
        self.assertEqual(actual, expected)
        self.assertEqual((actual['priorCases'], actual['heldOutCases']), (156,80))
        self.assertEqual({k:(v['priorMismatches'],v['heldOutMismatches']) for k,v in actual['paths'].items()},
            dict(floatTermsDoubleSum=(0,1),floatRowPenDoubleSum=(0,2),
                 floatTopPenDoubleSum=(0,1),doubleTopFloatRowPen=(0,1)))

    def test_source_dimensions_and_absence_of_visible_text_or_font_programs(self):
        folder = ROOT/'tests/fixtures/print-coordinate-phase'
        cases = json.loads((folder/'cases.json').read_bytes())
        w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        with ZipFile(folder/'control.docx') as package:
            self.assertFalse(any(name.startswith('word/fonts/') for name in package.namelist()))
            document = ET.fromstring(package.read('word/document.xml'))
        self.assertFalse(document.findall('.//'+w+'t'))
        tables = document.findall('.//'+w+'tbl')
        sections = document.findall('.//'+w+'sectPr')
        self.assertEqual(len(tables),80)
        self.assertEqual(len(sections),80)
        for index, (table, section, case) in enumerate(zip(tables,sections,cases)):
            self.assertEqual(case['topTwips'],[719,721,4456,7754][index//20])
            self.assertEqual(case['heightTwips'],[398,402,406,407][index%20//5])
            self.assertEqual(case['sizeEighthPoints'],[3,5,8,12,16][index%5])
            height = table.find('.//'+w+'trHeight')
            self.assertEqual(height.get(w+'hRule'),'exact')
            self.assertEqual(int(height.get(w+'val')),case['heightTwips'])
            self.assertEqual(int(section.find(w+'pgMar').get(w+'top')),case['topTwips'])
            for border in table.find('.//'+w+'tblBorders'):
                self.assertEqual(int(border.get(w+'sz')),case['sizeEighthPoints'])

    def test_same_total_and_float_term_sum_have_different_native_far_edges(self):
        rows = report()['rows']
        first = next(r for r in rows if r['fixture']=='print-row-pen-phase' and r['index']==60)
        second = next(r for r in rows if r['fixture']=='print-coordinate-phase' and r['index']==38)
        def inputs(row):
            return [row['topTwips'],row['heightTwips'],math.floor(row['sizeEighthPoints']*2.5)]
        self.assertEqual(sum(inputs(first)),sum(inputs(second)))
        self.assertEqual(sum(f32(v*f32(.05)) for v in inputs(first)),
                         sum(f32(v*f32(.05)) for v in inputs(second)))
        self.assertEqual((first['nativeFarUnits'],second['nativeFarUnits']),(482,483))
        # The heterogeneous-precision candidate fixes this pair, but is rejected
        # independently at a higher origin, rather than blessed by this pair.
        bad = report()['paths']['doubleTopFloatRowPen']['counterexamples']
        self.assertEqual([(r['fixture'],r['index'],r['nativeFarUnits'],r['predicted']['doubleTopFloatRowPen']) for r in bad],
            [('print-coordinate-phase',41,2028,2027)])

if __name__ == '__main__': unittest.main()
