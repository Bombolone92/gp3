import itertools
import unittest
from fractions import Fraction as F
from check_theme_hue_feasibility import feasible, transformed_light, fixed_hue_bounds, fixed_hue_evidence, hue_sector, hue_grid_evidence, conversion_rows, relative_channel_hue, relative_hue_evidence
from check_theme_chroma_stages import ROOT, SETS, load_rows


class HueFeasibilityTests(unittest.TestCase):
    def test_hash_bound_native_witness_and_independent_interval(self):
        rows = load_rows(ROOT / 'tests/fixtures/theme-shade-sweep')
        case, native = next(row for row in rows if row[0]['label'] == 'C139')
        self.assertEqual((case['base'], case['value'], native['rgb']), ('4F81BD', 139, [40, 69, 106]))
        # Green ratio is 5/11. Even the lowest allowed red and blue put green
        # exactly on its excluded upper bound. No choice of L or S can help.
        for bias in (F(0), F(1, 2)):
            lower_green = F(6, 11)*(40-bias) + F(5, 11)*(106-bias)
            self.assertEqual(lower_green, 70-bias)
            self.assertFalse(feasible(case['base'], native['rgb'], bias)['feasible'])

    def test_independent_native_midpoint_witness(self):
        rows = load_rows(ROOT / 'tests/fixtures/theme-chroma-midtones')
        case, native = next(row for row in rows if row[0]['label'] == 'C295')
        self.assertEqual((case['base'], native['rgb']), ('DFE0DE', [33, 35, 33]))
        for bias in (F(0), F(1, 2)):
            self.assertEqual(((33-bias)+(35-bias))/2, 34-bias)
            self.assertFalse(feasible(case['base'], native['rgb'], bias)['feasible'])

    def test_independently_encoded_continuous_rgb_is_never_rejected(self):
        # Construct valid colors directly, independently of polygon clipping.
        # Includes arbitrary L/S changes, RGB permutations and endpoint bins.
        for source in ([0, 1, 2], [79, 129, 189], [223, 224, 222], [0, 0, 255], [127, 127, 127]):
            low, high = min(source), max(source)
            for permutation in itertools.permutations(source):
                base = bytes(permutation).hex()
                ratios = [F(c-low, high-low) if high != low else F(0) for c in permutation]
                for p, q in [(F(0), F(255)), (F(0), F(0)), (F(255), F(255)),
                             (F(1, 3), F(7, 2)), (F(83, 2), F(701, 3))]:
                    colors = [(1-t)*p+t*q for t in ratios]
                    for bias in (F(0), F(1, 2)):
                        rgb = [int(c+bias) for c in colors]
                        self.assertTrue(feasible(base, rgb, bias)['feasible'], (base, rgb, bias))

    def test_open_boundary_and_achromatic_constraints(self):
        self.assertFalse(feasible('000102', [0, 0, 2])['feasible'])
        self.assertTrue(feasible('000102', [0, 1, 2])['feasible'])
        self.assertTrue(feasible('808080', [17, 17, 17])['feasible'])
        self.assertFalse(feasible('808080', [17, 18, 17])['feasible'])

    def test_exact_lightness_and_modifier_endpoints(self):
        for mode in ('shade', 'tint'):
            case = dict(base='4F81BD', value=255, mode=mode)
            self.assertEqual(transformed_light(case), 134)
            self.assertTrue(feasible(case['base'], [79, 129, 189], exact_light=134)['feasible'])
            case['value'] = 0
            light = transformed_light(case)
            self.assertEqual(light, 0 if mode == 'shade' else 255)
            self.assertTrue(feasible(case['base'], [int(light)]*3, exact_light=light)['feasible'])
        self.assertFalse(feasible('000102', [0, 1, 2], exact_light=100)['feasible'])

    def test_fixed_hue_necessary_intervals_can_prove_contradiction(self):
        def row(rgb):
            return dict(base='000102', label=str(rgb)), dict(rgb=rgb)
        # First output requires t < 1/2, second t > 3/4.
        rows = [row([0, 0, 2]), row([0, 4, 4])]
        proof = fixed_hue_bounds(rows, (0, 1, 2))
        self.assertTrue(proof['rejected'])
        self.assertEqual((proof['lower'], proof['upper']), ('3/4', '1/2'))
        self.assertTrue(fixed_hue_evidence(rows)[0]['rejected'])
        # Touching open bounds are also contradictory.
        self.assertTrue(fixed_hue_bounds([row([0, 0, 2]), row([0, 2, 2])], (0, 1, 2))['rejected'])
        self.assertFalse(fixed_hue_bounds([row([0, 1, 2])], (0, 1, 2))['rejected'])

    def test_adjusted_native_hue_remains_inconclusive(self):
        rows = load_rows(ROOT / 'tests/fixtures/theme-shade-sweep')
        blue = [(c, n) for c, n in rows if c['base'] == '4F81BD']
        proof = fixed_hue_bounds(blue, (0, 1, 2))
        self.assertFalse(proof['rejected'])
        self.assertEqual((proof['lower'], proof['upper']), ('17/38', '51/113'))
        self.assertLess(F(17, 38), F(9, 20))
        self.assertLess(F(9, 20), F(51, 113))
        self.assertGreater(F(5, 11), F(51, 113))

    def test_exact_hue_sectors_permutations_and_wrap(self):
        for source in itertools.permutations([0, 50, 110]):
            order, ratio = hue_sector(bytes(source).hex())
            self.assertEqual([source[i] for i in order], [0, 50, 110])
            self.assertEqual(ratio, F(5, 11))
        self.assertEqual(hue_sector('4F81BD'), ((0, 1, 2), F(5, 11)))
        self.assertEqual(hue_sector('4F81BD', 360, True), ((0, 1, 2), F(9, 20)))
        self.assertEqual(hue_sector('FF0001', 360, True), ((2, 1, 0), F(0)))
        self.assertEqual(hue_sector('FF0000'), ((2, 1, 0), F(0)))
        self.assertIsNone(hue_sector('808080'))

    def test_grid_rejections_are_not_finite_lightness_searches(self):
        rows = load_rows(ROOT / 'tests/fixtures/theme-shade-sweep')
        blue = [(c, n) for c, n in rows if c['base'] == '4F81BD']
        models = hue_grid_evidence(blue)
        original = next(m for m in models if m['scale'] is None)
        degree_nearest = next(m for m in models if m['scale'] == 360 and m['rounding'] == 'nearest')
        self.assertEqual(original['rejectedBases'], 1)
        # A shifted hue is NOT rejected for this source; whole-control evidence
        # rejects that grid on other bases. Never report a nonempty bound as pass.
        self.assertEqual(degree_nearest['rejectedBases'], 0)

    def test_neutral_identity_bypasses_initial_hue_quantization(self):
        identity = (dict(base='C0504D', value=255), dict(rgb=[192, 80, 77]))
        # Degree-floor hue 1 would violate identity's source RGB bins. A real
        # converter can return the source at FF without converting hue at all.
        self.assertEqual(conversion_rows([identity]), [])
        self.assertEqual(hue_grid_evidence([identity]), hue_grid_evidence([]))
        with self.assertRaisesRegex(ValueError, 'not source identity'):
            conversion_rows([(identity[0], dict(rgb=[191, 80, 77]))])

    def test_relative_channel_grid_resolves_both_independent_hue_witnesses(self):
        self.assertEqual(relative_channel_hue('4F81BD'), '0073ff')
        self.assertEqual(relative_channel_hue('DFE0DE'), '7fff00')
        for source, native in [('4F81BD', [40, 69, 106]), ('DFE0DE', [33, 35, 33])]:
            for bias in (F(0), F(1, 2)):
                self.assertTrue(feasible(relative_channel_hue(source), native, bias)['feasible'])
        for source in itertools.permutations([79, 129, 189]):
            expected = bytes([0, 115, 255][[79, 129, 189].index(c)] for c in source).hex()
            self.assertEqual(relative_channel_hue(bytes(source).hex()), expected)

    def test_full_hash_bound_relative_hue_floor_survives_but_nearest_does_not(self):
        rows = [(dict(c, fixture=name), n) for name in SETS for c, n in load_rows(ROOT/'tests/fixtures'/name)]
        self.assertEqual(len(rows), 2176)
        self.assertEqual(len(rows)-len(conversion_rows(rows)), 86)
        floor, nearest = relative_hue_evidence(rows)
        self.assertEqual((floor['cases'], floor['feasible'], floor['rejected']), (2090, 2090, 0))
        self.assertEqual((nearest['cases'], nearest['feasible'], nearest['rejected']), (2090, 2082, 8))
        witness = nearest['firstCounterexample']
        self.assertEqual((witness['base'], witness['value'], witness['native']), ('FF0100', 128, [128, 0, 0]))
        # Native red's nearest lower bound is 127.5; green ratio 1/255
        # forces green >= 0.5, excluded from the native green-0 bin.
        self.assertEqual(F(255, 2)/255, F(1, 2))

    def test_invalid_inputs(self):
        for rgb in (None, [0, 1], [0, True, 2], [0, -1, 2], [0, 256, 2]):
            with self.assertRaises(ValueError): feasible('000102', rgb)
        for base in (None, 'bad', 'xx0102', '00  02'):
            with self.assertRaises(ValueError): feasible(base, [0, 1, 2])
        with self.assertRaises(ValueError): feasible('000102', [0, 1, 2], F(1, 3))
        with self.assertRaises(ValueError): feasible('000102', [0, 1, 2], exact_light=0.5)
        with self.assertRaises(ValueError): fixed_hue_bounds([], (0, 0, 2))
        with self.assertRaises(ValueError): transformed_light(dict(base='000102', value=256, mode='shade'))
        with self.assertRaises(ValueError): hue_sector('000102', 0)


if __name__ == '__main__': unittest.main()
