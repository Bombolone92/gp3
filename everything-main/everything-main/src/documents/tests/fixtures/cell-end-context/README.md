# Cell-ending contextual spacing

Original, manually authored OOXML from `tools/cell_end_context_fixture.py`.
No corpus content or third-party document engine is used. The four 12-page
packages were exported read-only with the reference application via
`tools/export-reference.ps1`. `tools/record_cell_end_context.py` records
native text origins and SHA-256 hashes of each source and PDF.

Cases 1–4 use floating tables and cases 5–8 inline tables, crossing contextual
spacing on/off with following-body same/different paragraph styles. Cases 9–12
cover single-paragraph cells and differing first/last cell paragraph styles.
Every cell paragraph has 8 pt after-spacing and exact 14 pt line spacing.

`control` uses Normal as the default paragraph style. `default` makes Other the
default, `id` changes Normal's ID to BaseParagraph while keeping its name, and
`name` changes the name to Ordinary Text while retaining the original ID.
The reference application suppresses final after-spacing for contextual paragraphs whose style is
named Normal. The effect survives changing the ID and does not transfer to an
arbitrary new default style. The following body paragraph's style is immaterial.
This cell-boundary behavior extends the adjacent-paragraph rule in ECMA-376
Part 1 §17.3.1.9; the implicit Normal boundary is a model of observed behavior,
not an explicit source paragraph or a requirement stated in that clause.

Browser checks compare native origins within 0.2 pt and exercise editing,
export and reopening. Unit checks cover geometry, style changes, preservation
of unrelated parts and exact undo. Visual page-region comparisons also expose
the existing automatic text-color mismatch on the teal fill (native reference black,
app white); these controls certify spacing, not complete visual conformance.
