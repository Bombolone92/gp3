"""Keep independent native counterexamples and authored dimensions verifiable."""
import json,unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from check_print_local_extent_holdouts import ROOT,report


class LocalExtentTests(unittest.TestCase):
    def test_frozen_predictions_match_previous_controls_but_fail_fresh_capture(self):
        actual=report()
        expected=json.loads((ROOT/'docs/evidence/print-local-extent-holdouts-2026-10-10.json').read_bytes())
        self.assertEqual(actual,expected)
        self.assertEqual((actual['priorCases'],actual['priorMismatches'],
                          actual['heldOutCases'],actual['heldOutMismatches']),(236,0,80,3))
        bad=[r for r in actual['rows'] if not r['matches']]
        self.assertEqual([(r['index'],r['predictedFarUnits'],r['nativeFarUnits']) for r in bad],
                         [(13,483,482),(72,3408,3407),(79,3418,3417)])
        self.assertEqual([(r['index'],r['pageTranslationUnits'][1],r['localFarUnits'])
                          for r in actual['tableRangeObservations']],
                         [(12,301,177),(13,301,181),(72,3230,177),(79,3230,187)])

    def test_source_is_independently_authored_with_exact_dimensions_and_no_font_programs(self):
        folder=ROOT/'tests/fixtures/print-coordinate-independent-phase'
        cases=json.loads((folder/'cases.json').read_bytes())
        w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        with ZipFile(folder/'control.docx') as package:
            self.assertFalse(any(name.startswith('word/fonts/') for name in package.namelist()))
            document=ET.fromstring(package.read('word/document.xml'))
        self.assertFalse(document.findall('.//'+w+'t'))
        tables=document.findall('.//'+w+'tbl');sections=document.findall('.//'+w+'sectPr')
        self.assertEqual((len(tables),len(sections),len(cases)),(80,80,80))
        for i,(case,table,section) in enumerate(zip(cases,tables,sections)):
            self.assertEqual(case['topTwips'],[723,1441,4457,7753][i//20])
            self.assertEqual(case['heightTwips'],[397,401,405,409][i%20//5])
            self.assertEqual(case['sizeEighthPoints'],[3,5,8,12,16][i%5])
            height=table.find('.//'+w+'trHeight')
            self.assertEqual(height.get(w+'hRule'),'exact')
            self.assertEqual(int(height.get(w+'val')),case['heightTwips'])
            self.assertEqual(int(section.find(w+'pgMar').get(w+'top')),case['topTwips'])


if __name__=='__main__':unittest.main()
