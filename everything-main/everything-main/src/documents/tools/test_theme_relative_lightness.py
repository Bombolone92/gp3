import unittest
from fractions import Fraction as F
from check_theme_relative_lightness import chroma_bounds, fixed_saturation, light_units, light_models, bias_free_saturation
from check_theme_hue_feasibility import relative_channel_hue
from check_theme_chroma_stages import ROOT, SETS, load_rows


def encode(units, chroma, hue):
    # Independent continuous endpoints, not the solver's integer inequality.
    p, q = F(units-chroma, 6), F(units+chroma, 6)
    return [int((1-F(t, 255))*p+F(t, 255)*q) for t in hue]


class RelativeLightnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = [(dict(c, fixture=name), n) for name in SETS for c, n in load_rows(ROOT/'tests/fixtures'/name)]

    def test_integer_bounds_agree_with_independent_exhaustive_chroma(self):
        for units in [0, 1, 2, 15, 31, 44, 65, 722, 781, 1529, 1530]:
            maximum = min(units, 1530-units)
            for hue in [[0, 115, 255], [255, 0, 127], [64, 128, 190]]:
                possible = [encode(units, c, hue) for c in range(maximum+1)]
                for chroma in {0, maximum//2, maximum}:
                    for rgb in [possible[chroma], [(n+1)%256 for n in possible[chroma]]]:
                        accepted = [i for i, color in enumerate(possible) if color == rgb]
                        expected = (accepted[0], accepted[-1]) if accepted else None
                        self.assertEqual(chroma_bounds(units, hue, rgb), expected, (units, hue, rgb))
                        if accepted: self.assertEqual(accepted, list(range(accepted[0], accepted[-1]+1)))

    def test_native_unique_and_bounded_chroma_witnesses(self):
        rows = {c['label']: (c, n) for c, n in self.rows if c['fixture'] == 'theme-shade-sweep'}
        for label, rgb, units, bounds in [('C229', [65, 114, 174], 722, (327, 327)),
                                          ('C248', [73, 124, 187], 781, (341, 343))]:
            case, native = rows[label]
            self.assertEqual(native['rgb'], rgb)
            self.assertEqual(case['base'], '4F81BD')
            self.assertEqual(light_units(case), units)
            self.assertEqual(chroma_bounds(units, [0, 115, 255], rgb), bounds)

    def test_any_fixed_initial_saturation_is_rejected_for_six_sources(self):
        result = fixed_saturation(self.rows)
        self.assertEqual(result['chromaticConversionRows'], 1992)
        self.assertEqual(result['noChromaGridIntersection'], 0)
        self.assertEqual([r['base'] for r in result['results'] if r['rejected']],
                         ['4F81BD', '9B4139', '9B626C', 'C0504D', 'DFE0DE', 'FEFDFC'])
        blue = next(r for r in result['results'] if r['base'] == '4F81BD')
        self.assertEqual((blue['lower'], blue['upper']), ('341/749', '164/361'))
        self.assertGreater(341*361, 164*749)

    def test_independently_constructed_fixed_saturation_remains_feasible(self):
        hue = list(bytes.fromhex(relative_channel_hue('4F81BD')))
        for saturation in [F(0), F(2, 5), F(1)]:
            rows = []
            for mode in ['shade', 'tint']:
                for value in [0, 1, 13, 46, 100, 128, 228, 250, 254]:
                    case = dict(base='4F81BD', value=value, mode=mode)
                    units = light_units(case)
                    chroma = int(min(units, 1530-units)*saturation)
                    rows.append((case, dict(rgb=encode(units, chroma, hue))))
            result = fixed_saturation(rows)
            self.assertEqual(result['rejectedSources'], 0)
            self.assertEqual(result['noChromaGridIntersection'], 0)
            bounds = result['results'][0]
            self.assertLessEqual(F(bounds['lower']), saturation)
            self.assertLessEqual(saturation, F(bounds['upper']))

    def test_full_light_stage_constraints_and_floor_sixths_survival(self):
        results = light_models(self.rows)
        self.assertEqual([r['rejected'] for r in results], [101, 792, 0, 113, 137, 100])
        self.assertTrue(all(r['cases'] == 2090 for r in results))

    def test_static_initial_lightness_cannot_rescue_the_exact_transform(self):
        rows = {c['label']: (c, n) for c, n in self.rows if c['fixture'] == 'theme-shade-sweep'}
        first, second = rows['C012'], rows['C139']
        self.assertEqual((first[0]['base'], first[1]['rgb']), ('4F81BD', [3, 5, 8]))
        self.assertEqual((second[0]['base'], second[1]['rgb']), ('4F81BD', [40, 69, 106]))
        t = F(115, 255)
        # From middle<6 and maximum<9: L=(middle+(1-2t)*maximum)/(2*(1-t)).
        light_upper = (6+(1-2*t)*9)/(2*(1-t))
        initial_upper = light_upper*255/12
        initial_lower = F(40+106, 2)*255/139
        self.assertEqual((initial_upper, initial_lower), (F(29835, 224), F(18615, 139)))
        self.assertGreater(initial_lower, initial_upper)

    def test_arbitrary_fixed_chroma_bias_still_cannot_rescue_blue(self):
        rows = [(c, n) for c, n in self.rows if c['fixture'] == 'theme-shade-sweep' and c['label'] in ['C021', 'C229', 'C248']]
        self.assertEqual(len(rows), 3)
        result = bias_free_saturation(rows)['results'][0]
        self.assertTrue(result['rejected'])
        self.assertEqual((result['lower'], result['upper']), ('13/27', '303/656'))
        self.assertGreater(13*656, 303*27)

    def test_independent_fixed_bias_colors_are_not_rejected_at_gamut_clamps(self):
        hue = list(bytes.fromhex(relative_channel_hue('4F81BD')))
        for saturation in [F(0), F(2, 5), F(1)]:
            for bias in [F(-73, 10), F(0), F(1, 2), F(29, 10)]:
                rows = []
                for mode in ['shade', 'tint']:
                    for value in [0, 1, 13, 46, 100, 128, 228, 250, 254]:
                        case = dict(base='4F81BD', value=value, mode=mode)
                        units = light_units(case)
                        maximum = min(units, 1530-units)
                        chroma = max(0, min(maximum, int(maximum*saturation+bias)))
                        rows.append((case, dict(rgb=encode(units, chroma, hue))))
                self.assertEqual(bias_free_saturation(rows)['rejectedSources'], 0, (saturation, bias))

    def test_invalid_integer_frames(self):
        for units, hue, rgb in [(True, [0, 127, 255], [0, 1, 2]), (-1, [0, 127, 255], [0, 1, 2]),
                                (1531, [0, 127, 255], [0, 1, 2]), (10, [0, 127], [0, 1, 2]),
                                (10, [0, 127, 256], [0, 1, 2]), (10, [0, 127, 255], [0, 1, 2.5])]:
            with self.assertRaises(ValueError): chroma_bounds(units, hue, rgb)


if __name__ == '__main__': unittest.main()
