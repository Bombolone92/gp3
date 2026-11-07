"""Retain native holdouts that reject direct coordinate conversion candidates."""
import json, unittest
from check_print_row_coordinate_paths import ROOT,compare

class CoordinatePathTests(unittest.TestCase):
    def test_reproduces_all_recorded_sources_and_native_comparisons(self):
        report=json.loads((ROOT/'docs/evidence/print-row-coordinate-paths-2026-10-10.json').read_bytes())
        self.assertEqual(compare(),report)
        self.assertEqual(report['cases'],156)
        self.assertEqual({k:v['mismatches'] for k,v in report['paths'].items()},
            dict(wholeTwipDouble=14,floatPointSum=9,floatFactorSequential=4,
                 floatFactorBorderFirst=4,floatTwipSumFactor=17))

    def test_preexisting_ties_pass_but_independent_pen_holdouts_reject_candidate(self):
        rows=compare()['rows']
        prior=[r for r in rows if r['fixture']!='print-row-pen-phase']
        self.assertEqual(len(prior),76)
        self.assertTrue(all(r['nativeFarUnits']==r['predicted']['floatFactorSequential'] for r in prior))
        bad=[r for r in rows if r['nativeFarUnits']!=r['predicted']['floatFactorSequential']]
        self.assertEqual([(r['fixture'],r['index'],r['heightTwips'],r['sizeEighthPoints'],
            r['nativeFarUnits'],r['predicted']['floatFactorSequential']) for r in bad],
            [('print-row-pen-phase',11,407,3,473,472),('print-row-pen-phase',22,402,5,473,472),
             ('print-row-pen-phase',60,408,12,482,483),('print-row-pen-phase',66,398,16,482,483)])

if __name__=='__main__':unittest.main()
