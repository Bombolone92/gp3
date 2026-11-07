# Script and small-cap composition

`tools/script_compound_position_fixture.py` manually authors eight OPC rows:
12 and 20 pt, superscript and subscript, plain uppercase and lowercase small
capitals. It uses the existing OFL Bebas Neue source with an original family
name and a 650-unit superscript size recommendation. Glyphs, hints, advances
and other metrics are unchanged. The generator reproduces every input byte;
the included OFL license and base-font hash record its provenance.

The reference application opened the source read-only and captured Range.EnhMetaFileBits.
`native-capture.json` binds the unchanged source and native EMF. Temporary font
registration was removed and the owned reference-application instance closed after capture.
`tools/record_script_compound_positions.py` validates the original XML and font
tables, bounded native coordinate mapping, selected descriptions and hashes.
GDI re-selection establishes current font resolution, not a retrospective
dump of the font bytes used inside the reference application.

The native baselines are unchanged by small caps. Script glyph sizes are
reduced first, then small capitals use 80% of that reduced size rounded to
half points. At 12 pt the superscript is 8 pt and its small capitals are
6.5 pt; the subscript is 7 pt and its small capitals are 5.5 pt. At 20 pt,
the corresponding sizes are 13/10.5 and 12/9.5 pt.

ECMA-376 Part 1 §§17.3.2.33 and 17.3.2.42 describe small capitals and vertical
alignment. The exact script positioning formula is native compatibility
evidence, not a normative requirement in `vertAlign`. The reference application's proportional
small-cap reduction differs from the fixed two-point example already recorded
in the project's capitalization conformance notes. This original control
establishes the composition order without a document or family-name exception.

`tools/test_script_position_controls.py` checks regeneration, capture hashes,
native heights/baselines and rejection of altered mapping. The browser checks
actual painted glyph sizes and baselines, editing, untouched package parts,
exact undo and reopening the export.
