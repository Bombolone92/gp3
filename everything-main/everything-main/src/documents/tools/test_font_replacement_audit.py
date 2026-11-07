"""Meaningful regression controls for the replacement-review guard."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit', ROOT/'tools/audit-font-replacement.py')
audit = importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)
SOURCE = ROOT/'tests/fixtures/woff-controls/optional.ttf'


class ReplacementAudit(unittest.TestCase):
    def test_same_font_repackaged_does_not_fail(self):
        result = audit.compare(SOURCE, SOURCE.with_suffix('.woff'))
        self.assertTrue(result['coveragePreserved'])
        self.assertEqual(result['current']['unicodeCharacters'], 4)
        self.assertNotEqual(result['current']['sha256'], result['candidate']['sha256'])

    def test_removed_character_is_named_and_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'removed.ttf'
            font = TTFont(SOURCE, recalcTimestamp=False)
            for table in font['cmap'].tables:
                if table.isUnicode(): table.cmap.pop(86, None)
            font.save(target); font.close()
            result = audit.compare(SOURCE, target)
            self.assertFalse(result['coveragePreserved'])
            self.assertEqual(result['lostCharacters'], [{'codePoint':'U+0056', 'name':'LATIN CAPITAL LETTER V', 'category':'Lu'}])

    def test_union_includes_secondary_unicode_map_but_ignores_symbol_platform(self):
        font = TTFont(SOURCE)
        try:
            for platform, encoding, code in [(0,4,0x10000),(3,0,0xf041)]:
                table=CmapSubtable.newSubtable(12); table.platformID=platform; table.platEncID=encoding
                table.language=0; table.cmap={code:'A'}; font['cmap'].tables.append(table)
            points, _ = audit.coverage(font)
            self.assertIn(0x10000, points); self.assertNotIn(0xf041, points)
        finally: font.close()

    def test_missing_glyph_slot_is_not_reported_as_coverage(self):
        font=TTFont(SOURCE)
        try:
            for table in font['cmap'].tables:
                if table.isUnicode(): table.cmap[0x1234]='.notdef'
            self.assertNotIn(0x1234, audit.coverage(font)[0])
        finally: font.close()

    def test_variation_sequence_loss_is_separate_from_base_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'variation.ttf'; font=TTFont(SOURCE, recalcTimestamp=False)
            table=CmapSubtable.newSubtable(14); table.platformID=0; table.platEncID=5; table.language=0
            table.cmap={}; table.uvsDict={0xfe00:[(65,None),(86,'V')]}; font['cmap'].tables.append(table)
            font.save(target); font.close()
            result=audit.compare(target,SOURCE)
            self.assertFalse(result['coveragePreserved']); self.assertEqual(result['lostCharacters'],[])
            self.assertEqual(len(result['lostVariationSequences']),2)

    def test_ambiguous_format_copies_and_unmatched_candidates_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'Same.ttf').write_bytes(SOURCE.read_bytes())
            (root/'same.woff').write_bytes(SOURCE.with_suffix('.woff').read_bytes())
            with self.assertRaises(ValueError): audit.files(root)
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            (Path(b)/'new.ttf').write_bytes(SOURCE.read_bytes())
            with self.assertRaises(ValueError): audit.main([a,b,str(Path(a)/'result.json')])


if __name__ == '__main__': unittest.main()
