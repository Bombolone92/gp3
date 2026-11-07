The independent OPC/XML generator `tools/canvas_compound_row_insets_fixture.py`
extends the hand-authored row grid with single, double and triple 2pt borders,
each with automatic, minimum and exact 48pt body-row heights. The first body
row has no own top border, while the following row does.

The reference application opened the exact public fixture and exported nine PDF pages
and FlatOPC without saving changes. `manifest.json` records source/capture
hashes; `positions.json` records all 45 PDF text origins. Current canvas
baselines differ by at most 0.12pt. Browser tests exercise edits, retained
package parts, exact undo and reopening against these references.

These short-row cases confirm that the writing inset formula also applies
to compound borders. They do not cover multi-page-row / repeated-header
behavior. The eight-versus-nine-page regression was subsequently fixed through
table-wide style-border handling and physical bottom-border reservation; see
`../style-cell-borders/README.md`. The original browser assertion is retained.
