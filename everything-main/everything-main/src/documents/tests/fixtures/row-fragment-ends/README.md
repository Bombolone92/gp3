# Continued row content bounds

`tools/canvas_row_fragment_ends_fixture.py` authors XML variants of the manual
`style-cell-borders.docx` probe. No Documents exporter creates the references.
The reference application opened each exact input, exported its PDF, and closed without
saving the DOCX. The promoted sources regenerate with byte-identical OPC parts.
`manifest.json` records source and PDF hashes. `reference.json` records
text origins and painted red/yellow rectangles (PDF clip paths are excluded).

The probes cover:

- `bottom-neighbor`: a long cell beside a short bottom-aligned, yellow cell.
- `minimum`: a 120 pt minimum height, preserved on the first fragment.
- `merged`: a long vertical merge spanning two logical rows.
- `spaced`: 3 pt before / 6 pt after each numbered paragraph; the native reference uses 14 pages.
- `contextual`: the same spacing with contextual suppression; retained as a
  reference for the separate first/last-cell spacing discrepancy below.
- `oversized-spacing`: two paragraphs with 400 pt after-spacing; retained as
  an unresolved clipping reference, not a passing native-fidelity case.

For ordinary split rows, the reference application puts the bottom border immediately after fitted
content and cell padding rather than at the unused writing-area limit. All
cells share this physical row edge, including an empty neighboring fragment.
Declared minimums can extend the first fragment; exact and oversized declared
rows keep their existing allocation/clipping constraints. A cell's final
paragraph line must also fit its retained after-spacing. Table shading starts
and ends at the leading horizontal border edges, not their centerlines.

The four browser cases compare every numbered body paragraph's page and origin
within 0.2 pt, plus red border and yellow fill bounds within one raster pixel
plus 0.2 pt. The extra raster allowance covers pixel coverage and the reference application's PDF
stroke quantization. Independent vector measurements differ by less than
0.1 pt at the continued bottom ink edges. Tests also cover source-part
preservation, editing, byte-exact undo, canvas restoration and reopening.
Existing short-row, exact-row, nested-table, continuation and contextual-spacing
tests remain regression checks. Arial must be installed for native reference comparisons.

These references explicitly retain three outstanding discrepancies:

- In `merged`, the short second-row neighbor baseline on page 1 differs from
  the reference application by about 2.08 pt. The numbered merged text and continued ink edges match;
  the new browser test does not claim all merged-neighbor baselines match.
- In `contextual`, the reference application suppresses the first 3 pt before-spacing and final 6 pt
  after-spacing at the cell boundaries. The existing layout does not. Interior
  contextual gaps match; boundary behavior needs separate style/compatibility
  probes before changing the existing no-cross-cell rule.
- In `oversized-spacing`, the reference application's legacy layout clips the remainder of the long
  row after moving it to a fresh page. Documents retains a different visible
  flow. The overflowing-gap fallback is unchanged by the ordinary spacing fix.

None of these cases is counted as a completely reviewed corpus template.
