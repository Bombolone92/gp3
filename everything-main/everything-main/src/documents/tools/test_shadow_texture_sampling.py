"""Texture/coverage invariants and bounded diagnostic input/output controls."""
from contextlib import redirect_stderr
from io import StringIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import probe_shadow_texture_sampling as sampling


class TextureSamplingControls(unittest.TestCase):
    def test_uniform_alpha_retains_shape_coverage_in_every_model(self):
        expected = np.array([[72, 24], [24, 8]])
        for mode in ['center', 'coupled-corners', 'coupled-centers']:
            for texture in ['nearest', 'bilinear']:
                for rounding in ['fractional', 'byte-samples']:
                    with self.subTest(mode=mode, texture=texture, rounding=rounding):
                        actual = sampling.sample_mask(np.array([[128.]]), 2, [.25, .25, 1, 1], mode, texture, rounding)
                        np.testing.assert_array_equal(actual, expected)

    def test_nonuniform_coverage_samples_change_the_texture_average(self):
        source = np.array([[0., 255.], [0., 255.]])
        center = sampling.sample_mask(source, 2, [0, 0, 2, 2], 'center', 'bilinear', 'fractional')
        coupled = sampling.sample_mask(source, 2, [0, 0, 2, 2], 'coupled-centers', 'bilinear', 'fractional')
        np.testing.assert_array_equal(center, [[0, 255], [0, 255]])
        # Four clamped and four interpolated subpixels give 31.875 / 223.125.
        np.testing.assert_array_equal(coupled, [[32, 223], [32, 223]])

    def test_trace_rejects_nonbyte_alpha_and_changed_authored_geometry(self):
        density = 140 / (192 * 1.02 + 96 + .32)
        trace = dict(width=140, height=140, inputMask=dict(width=384, height=384, alpha=[128] * (384 * 384)),
            geometry=dict(sourceWidth=192, sourceHeight=192, blur=48, sx=1.02, sy=1.02,
                boxX=23., boxY=23., boxW=94., boxH=94., scaleX=density, scaleY=density))
        with tempfile.TemporaryDirectory(prefix='shadow-texture-') as directory:
            path = Path(directory) / 'owned.json'
            path.write_text(json.dumps(trace))
            data, source, box, sigma = sampling.read_trace(path)
            self.assertEqual(source.shape, (384, 384))
            self.assertEqual(box, [23, 23, 94, 94])
            self.assertGreater(sigma, 0)
            self.assertEqual(data, path.read_bytes())
            for value in [True, -1, 256, .5]:
                trace['inputMask']['alpha'][0] = value
                path.write_text(json.dumps(trace))
                with self.assertRaisesRegex(ValueError, 'byte-valued'):
                    sampling.read_trace(path)
            trace['inputMask']['alpha'][0] = 128
            trace['geometry']['blur'] = 49
            path.write_text(json.dumps(trace))
            with self.assertRaisesRegex(ValueError, 'authored geometry'):
                sampling.read_trace(path)

    def test_oversized_input_is_refused_before_reading(self):
        with patch.object(Path, 'stat') as stat, patch.object(Path, 'read_bytes') as read:
            stat.return_value.st_size = 16_000_001
            with self.assertRaisesRegex(ValueError, 'byte budget'):
                sampling.read_trace('owned.json')
            read.assert_not_called()

    def test_changed_native_identity_is_refused_before_trace_reads(self):
        with patch.object(sampling.probe, 'digest', return_value='changed'), patch.object(sampling, 'read_trace') as read:
            with self.assertRaisesRegex(ValueError, 'Changed native evidence'):
                sampling.audit('owned.json')
            read.assert_not_called()

    def test_occupied_destination_is_refused_before_audit(self):
        with tempfile.TemporaryDirectory(prefix='shadow-texture-') as directory:
            path = Path(directory) / 'evidence.json'
            path.write_bytes(b'owned evidence')
            with patch.object(sys, 'argv', ['probe', '--mask-buffer', 'missing.json', '--output', str(path)]), \
                    patch.object(sampling, 'audit') as audit, redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as result:
                    sampling.main()
                self.assertEqual(result.exception.code, 2)
                audit.assert_not_called()
            self.assertEqual(path.read_bytes(), b'owned evidence')


if __name__ == '__main__':
    unittest.main()
