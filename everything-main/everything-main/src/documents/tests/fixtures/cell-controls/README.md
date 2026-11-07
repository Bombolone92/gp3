# Temporary cell-level content controls

`tools/cell_controls_fixture.py` authors this fixture from original XML/content
and python-docx's MIT boilerplate. It contains six temporary controls around
whole cells, including multiple paragraphs, placeholder text, an empty placeholder
and a horizontally spanning cell. `native.pdf` is the native print
reference. `native-lines.json` records PDF glyph origins and `native-edits.json`
records native editing observations. The manifest hashes the source and evidence.

The reference application retained all six controls after making “Cell alpha” bold, then removed only
that cell's wrapper when inserting X inside its text. This agrees with ECMA-376
Part 1 §§17.5.2.32–33 (cell-level sdt/sdtContent) and §17.5.2.43 (temporary).
No reference/spec divergence was found for this feature. Persistent, locked, bound
and row-level controls still require their own interaction support.

`cell-controls-baseline.docx` removes only the six wrappers. Its native
`native-baseline.pdf` raster is pixel-identical to the controlled native reference page.
The browser requires exact controlled/unwrapped layout equality and native
vertical origins. A pre-existing legacy table x-offset of 5.4pt remains in the
engine for both versions; these tests do not claim to fix that separate defect.
