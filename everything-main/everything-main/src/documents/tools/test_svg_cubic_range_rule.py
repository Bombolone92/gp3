import unittest
import numpy as np
from probe_svg_cubic_range_rule import holdouts,samples,range_candidate
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_flatten import finite_difference


class RangeRule(unittest.TestCase):
    def test_range_model_preserves_all_native_vertex_counts_and_existing_exact_matches(self):
        count=0
        for _,cases,native in holdouts():
            for name,p,e,exact in samples(cases,native):
                a=range_candidate(p)
                self.assertEqual(a.shape,e.shape,name)
                if exact:np.testing.assert_array_equal(a,e,err_msg=name)
                count+=1
        self.assertEqual(count,972)

    def test_diagnostic_defaults_remain_unchanged(self):
        for _,cases,_ in holdouts():
            for c in cases[::23]:
                p=np.asarray(c['points'])
                np.testing.assert_array_equal(candidate(p),candidate(p,error_units=12,half_delta='separate'))
                np.testing.assert_array_equal(candidate(p),finite_difference(p))

    def test_diagnostic_bounds_and_models_reject_invalid_options(self):
        p=np.zeros((4,2))
        for value in [0,-1,np.nan,np.inf]:
            with self.assertRaises(ValueError):candidate(p,error_units=value)
        with self.assertRaises(ValueError):candidate(p,half_delta='unknown')


if __name__=='__main__':unittest.main()
