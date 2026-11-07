import json
import tempfile
import unittest
from pathlib import Path
from check_theme_chroma_stages import ROOT, SETS, load_rows
from check_theme_minmax_neighbors import DIRECTORY, SOURCE, evidence
from theme_minmax_neighbors_fixture import generate, BASES, VALUES


class NativeNeighborTests(unittest.TestCase):
    def test_authored_source_is_reproducible_and_has_full_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, count = generate(Path(temporary))
            self.assertEqual(count, 208)
            self.assertEqual(source.read_bytes(), (DIRECTORY/SOURCE).read_bytes())
            self.assertEqual((source.parent/'cases.json').read_bytes(), (DIRECTORY/'cases.json').read_bytes())
        rows = load_rows(DIRECTORY, SOURCE)
        for base in BASES:
            for mode in ('shade', 'tint'):
                self.assertEqual([c['value'] for c, n in rows if c['base'] == base and c['mode'] == mode], VALUES)

    def test_all_overlapping_observations_agree_with_prior_independent_controls(self):
        prior = {}
        for name in SETS:
            for case, native in load_rows(ROOT/'tests/fixtures'/name):
                key = (case['base'], case['mode'], case['value'])
                if key in prior:
                    self.assertEqual(prior[key], native['rgb'], key)
                prior[key] = native['rgb']
        overlap = [(c, n) for c, n in load_rows(DIRECTORY, SOURCE) if (c['base'], c['mode'], c['value']) in prior]
        self.assertEqual(len(overlap), 32)
        self.assertEqual(sum(c['mode'] == 'shade' for c, n in overlap), 26)
        for case, native in overlap:
            self.assertEqual(prior[(case['base'], case['mode'], case['value'])], native['rgb'], case)

    def test_neutral_modifiers_preserve_all_source_bytes(self):
        rows = [(c, n) for c, n in load_rows(DIRECTORY, SOURCE) if c['value'] == 255]
        self.assertEqual(len(rows), 16)
        for case, native in rows:
            self.assertEqual(native['rgb'], list(bytes.fromhex(case['base'])))

    def test_holdout_reproduces_persisted_constraints(self):
        result = evidence()
        self.assertEqual(result, json.loads((ROOT/'docs/evidence/theme-minmax-neighbors-2026-10-04.json').read_text()))
        self.assertEqual((result['totalRows'], result['newNeighborRows'], result['nativePages']), (208, 156, 6))
        self.assertEqual((result['priorInputOverlap'], result['newInputRows']), (32, 176))
        self.assertEqual([r['rejected'] for r in result['lightModels']], [20, 69, 0, 23, 21, 20])
        self.assertEqual(result['fixedSaturation']['rejectedSources'], 7)
        self.assertEqual(result['arbitraryRoundingBias']['rejectedSources'], 7)


if __name__ == '__main__': unittest.main()
