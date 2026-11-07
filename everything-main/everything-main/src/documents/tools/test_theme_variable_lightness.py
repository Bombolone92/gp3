import unittest
from fractions import Fraction
from check_theme_variable_lightness import saturation_bounds, analyze, evidence

class VariableLightnessTests(unittest.TestCase):
    def test_native_floor_cannot_be_repaired_by_any_lightness_quantization(self):
        result = evidence()['results']['C0504D']['floor']
        self.assertTrue(result['rejected'])
        self.assertEqual(result['lower'], dict(modifier=228, rgb=[177,65,62], bound='19/40'))
        self.assertEqual(result['upper'], dict(modifier=14, rgb=[10,4,4], bound='7/15'))

    def test_native_nearest_rejects_both_bases(self):
        results = evidence()['results']
        self.assertTrue(all(row['nearest']['rejected'] for row in results.values()))
        self.assertFalse(results['4F81BD']['floor']['rejected'])

    def test_uninformative_black_and_non_dark_output_are_excluded(self):
        self.assertIsNone(saturation_bounds([0,0,0],Fraction(1,2)))
        self.assertIsNone(saturation_bounds([254,252,250]))
        self.assertEqual(saturation_bounds([10,4,4]), (Fraction(1,3),Fraction(7,15)))
        self.assertEqual(saturation_bounds([2,0,0]), (Fraction(1,3),Fraction(2)))

    def test_valid_hsl_extrema_with_arbitrary_lightness_are_not_rejected(self):
        for bias in [Fraction(0),Fraction(1,2)]:
            rows=[]
            saturation=Fraction(2,5)
            for light in [Fraction(5,2),Fraction(17,3),Fraction(80),Fraction(121)]:
                high=int(light*(1+saturation)+bias)
                low=int(light*(1-saturation)+bias)
                rows.append([high,(high+low)//2,low])
            self.assertFalse(analyze(rows,bias)['rejected'])

if __name__ == '__main__': unittest.main()
