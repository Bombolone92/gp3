import unittest
from fractions import Fraction
import numpy as np
from probe_svg_cubic_sampling import affine_references,parameters,direct
from probe_svg_cubic_arithmetic import candidate

class Sampling(unittest.TestCase):
    def test_parameter_trace_preserves_bounded_dyadic_steps(self):
        cases,_,_=affine_references()
        for c in cases:
            p=np.asarray(c['points']);ts=parameters(p)
            self.assertEqual(len(ts),len(candidate(p)))
            self.assertEqual((ts[0],ts[-1]),(0,1))
            for a,b in zip(ts,ts[1:]):
                self.assertGreater(b,a)
                self.assertLessEqual(Fraction(b-a).denominator,65536)
                self.assertEqual(Fraction(b-a).numerator,1)

    def test_polynomial_bases_agree_on_exact_dyadic_control(self):
        p=np.asarray([[0,0],[16,64],[-16,64],[0,0]])
        ts=[i/8 for i in range(9)]
        expected=direct(p,ts,'bernstein',64)
        for bits in (32,64):
            for model in ('bernstein','horner','horner-nested','casteljau'):
                np.testing.assert_array_equal(direct(p,ts,model,bits),expected)
        np.testing.assert_array_equal(expected[[0,-1]],p[[0,-1]])

    def test_new_threshold_options_do_not_change_the_default(self):
        cases,_,_=affine_references()
        for c in cases[::21]:
            p=np.asarray(c['points'])
            np.testing.assert_array_equal(candidate(p),candidate(p,initial_strict=False,coarsen_strict=False))
        with self.assertRaises(ValueError):direct(np.zeros((4,2)),[0,1],'unknown',64)

if __name__=='__main__':unittest.main()
