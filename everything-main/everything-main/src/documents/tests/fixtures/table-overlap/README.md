# Floating-table overlap controls

Original text-only OOXML controls, authored by `tools/table_overlap_fixture.py`
using our page-alignment fixture's package boilerplate. No corpus text or artwork
is included. Arial is required for native text measurements and is not bundled.
Reference PDFs were exported by the reference application. JSON files pin source
and PDF hashes and record non-space text origins in points.

`probe` has 15 pages: omitted/explicit overlap and never on either/both tables,
under page, margin and text vertical anchors. `width` has 12 pages: four table
widths and three horizontal clearances. `gap` has 11 pages distinguishing the
two facing clearances and their minimums. The reference application moves the later table to the
right when there is room, otherwise below. This is the reference application's placement policy for
the collision-prevention requirement in ECMA-376 sections 17.4.56 and 17.18.88;
the standard does not prescribe a specific displacement algorithm.

Browser geometry assertions allow 0.35 pt horizontally and 0.2 pt vertically.
The final width case now checks all body text too. Eight additional `words`
pages distinguish short words that fit beside the table, words that must move
below it, and words wider than the whole paragraph that clear the table before
breaking across lines. The former expected failure is a normal passing assertion.
Generate this additional family with `python tools/narrow_table_words_fixture.py`
and record its reference export with `python tools/record_table_overlap_reference.py words`.

Nested collision prevention and collision-driven page migration remain
unsupported. Imported overlap settings are retained in the table XML shell;
the displacement is a layout result, not an edit to authored coordinates.

Regenerate with `python tools/table_overlap_fixture.py`, then export each DOCX
with `tools/export-reference.ps1` to its corresponding `*-native.pdf` and run
`python tools/record_table_overlap_reference.py probe` (and width, gap).
The generator has been checked to reproduce every uncompressed package part
of all three retained sources exactly.
