"""Diagnostic arithmetic and independently captured native reference checks."""
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import probe_svg_cubic_state_representations as probe
from probe_svg_cubic_flatten import quantized_input


class StateRepresentations(unittest.TestCase):
    def test_straight_geometry_survives_every_state_basis(self):
        points=np.asarray([[0,0],[1,1],[2,2],[3,3]],dtype=float)
        expected=np.asarray([[0,0],[3,3]])
        for bits in [32,64]:
            for rounding in ['up','even']:
                for combined in [False,True]:
                    np.testing.assert_array_equal(probe.floating_state(points,bits,rounding,combined),expected)
        for precision in range(23):
            for division in ['floor','up','even']:
                np.testing.assert_array_equal(probe.midpoint_state(points,precision,division),expected)

    def test_narrow_native_counterexamples_reject_bankers_terminal_rounding(self):
        cases,native,_=probe.references('svg-cubic-terminal-rounding')
        for case,row in zip(cases,native,strict=True):
            expected=np.asarray(row['points']).reshape(-1,2)
            points=quantized_input(case['points'])
            for bits in [32,64]:
                np.testing.assert_array_equal(probe.floating_state(points,bits=bits),expected)
                self.assertFalse(np.array_equal(probe.floating_state(points,bits=bits,rounding='even'),expected))

    def test_split_native_controls_remain_required_in_both_state_bases(self):
        cases,native,_=probe.references('svg-cubic-step-split')
        for case,row in zip(cases,native,strict=True):
            expected=np.asarray(row['points']).reshape(-1,2)
            points=quantized_input(case['points'])
            np.testing.assert_array_equal(probe.floating_state(points,bits=32),expected)
            np.testing.assert_array_equal(probe.midpoint_state(points,precision=14),expected)

    def test_rejects_unbound_native_capture_hash(self):
        previous=probe.ROOT
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)/'untrusted';folder.mkdir()
            (folder/'cases.json').write_text('[]')
            (folder/'native-api.json').write_text(json.dumps({'inputSha256':'0'*64}))
            try:
                probe.ROOT=Path(directory)
                with self.assertRaises(AssertionError):probe.references('untrusted')
            finally:probe.ROOT=previous

    def test_midpoint_whole_fit_has_native_split_counterexamples(self):
        counts=[]
        for family in ['svg-cubic-step-changes','svg-cubic-step-split']:
            cases,native,_=probe.references(family)
            counts.append(sum(np.array_equal(
                probe.midpoint_state(quantized_input(case['points']),precision=6,division='even'),
                np.asarray(row['points']).reshape(-1,2)) for case,row in zip(cases,native,strict=True)))
        # This is a rejected diagnostic hypothesis, never a runtime rule.
        self.assertEqual(counts,[8,11])


if __name__=='__main__':unittest.main()
