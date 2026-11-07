"""Native controls and immutable-output boundary for the grid diagnostic."""
from contextlib import redirect_stderr
import hashlib
from io import BytesIO, StringIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import probe_shadow_native_grid as probe
import probe_shadow_kernel_coefficients as coefficients
import probe_shadow_mask_sampling as mask_sampling
import probe_shadow_texture_kernel as texture_kernel


class NativeGridControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = json.loads((probe.FOLDER / 'reference.json').read_text())

    def compare(self, name, **options):
        index, case = next((i, c) for i, c in enumerate(self.reference['cases'], 1) if c['name'] == name)
        png = probe.shadow_png(probe.FOLDER / f'shadow-color-{index}.emf')
        self.assertEqual(hashlib.sha256(png).hexdigest(), case['images'][0]['pngSha256'])
        actual = np.asarray(Image.open(BytesIO(png)).convert('RGBA'))
        n, predicted = probe.predict(case, 'rounded-extent', 'floor', 'horizontal-byte', **options)
        self.assertEqual(actual.shape, (n, n, 4))
        # Undefined transparent RGB is excluded; alpha is always compared.
        delta = predicted.astype(int) - actual.astype(int)
        delta[:, :, :3][actual[:, :, 3] == 0] = 0
        self.assertEqual(int(np.count_nonzero(delta)), 0)

    def test_three_point_low_alpha_native_pixels(self):
        self.compare('source-64-blur-3-color-8040C0')

    def test_independent_fractional_aspect_and_translation_dimensions(self):
        rows = probe.boundary_dimensions()['rows']
        self.assertEqual(len(rows), 16)
        self.assertTrue(all(row['dimensionMatches'] for row in rows))

    def test_eighteen_point_high_alpha_native_pixels(self):
        self.compare('source-192-blur-18-color-8040C0')

    def test_integer_coefficients_match_all_eighteen_small_blur_controls(self):
        selected = [case for case in self.reference['cases'] if case['blurPt'] <= 18]
        self.assertEqual(len(selected), 18)
        for case in selected:
            with self.subTest(case=case['name']):
                self.compare(case['name'], coefficient_bits=15)

    def test_padding_box_sampler_matches_all_twenty_four_native_controls(self):
        self.assertEqual(len(self.reference['cases']), 24)
        for case in self.reference['cases']:
            with self.subTest(case=case['name']):
                self.compare(case['name'], coefficient_bits=15, mask_sampling='padding-parity-8x4')

    def test_existing_uniform_alphas_do_not_distinguish_fractional_coverage(self):
        self.assertEqual({case['sourceAlpha'] for case in self.reference['cases']}, {64, 128, 192})
        for case in self.reference['cases']:
            with self.subTest(case=case['name']):
                self.compare(case['name'], coefficient_bits=15,
                    mask_sampling='padding-parity-8x4', mask_rounding='fractional')

    @unittest.expectedFailure
    def test_integer_coefficients_still_require_exact_large_blur_pixels(self):
        self.compare('source-192-blur-48-color-8040C0', coefficient_bits=15)

    @unittest.expectedFailure
    def test_middle_alpha_rounding_still_requires_exact_native_pixels(self):
        self.compare('source-128-blur-18-color-8040C0')

    @unittest.expectedFailure
    def test_large_blur_still_requires_exact_native_pixels(self):
        self.compare('source-192-blur-48-color-8040C0')

    def test_occupied_output_is_rejected_before_native_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'retained.json'
            output.write_bytes(b'retained evidence')
            with patch.object(sys, 'argv', ['probe', '--output', str(output)]), patch.object(probe, 'audit', side_effect=AssertionError('Must not read captures')), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as error:
                    probe.main()
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(output.read_bytes(), b'retained evidence')

    def test_coefficient_output_preserves_existing_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'retained.json'
            output.write_bytes(b'retained evidence')
            with patch.object(sys, 'argv', ['probe', '--output', str(output)]), patch.object(coefficients, 'audit', side_effect=AssertionError('Must not read captures')), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as error:
                    coefficients.main()
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(output.read_bytes(), b'retained evidence')

    def test_mask_sampling_output_preserves_existing_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'retained.json'
            output.write_bytes(b'retained evidence')
            with patch.object(sys, 'argv', ['probe', '--output', str(output)]), patch.object(mask_sampling, 'audit', side_effect=AssertionError('Must not read captures')), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as error:
                    mask_sampling.main()
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(output.read_bytes(), b'retained evidence')

    def test_texture_kernel_output_preserves_existing_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'retained.json'
            output.write_bytes(b'retained evidence')
            with patch.object(sys, 'argv', ['probe', '--mask-buffer', 'missing.json', '--output', str(output)]), patch.object(texture_kernel, 'audit', side_effect=AssertionError('Must not read captures')), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as error:
                    texture_kernel.main()
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(output.read_bytes(), b'retained evidence')


if __name__ == '__main__':
    unittest.main()
