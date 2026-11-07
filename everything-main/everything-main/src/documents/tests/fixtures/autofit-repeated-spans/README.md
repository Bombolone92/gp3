# Repeated AutoFit span preferences

Original OPC/XML controls authored by `tools/autofit_repeated_spans_fixture.py`.
The eight pages use Arial 10pt, compatibility mode 15, a 300pt-wide 100% AutoFit
table, a saved 50/200/50pt grid, and individual cell preferences of 70/200/70pt.
Zero, one, three or six full-span rows request 330pt, placed before or after the
individual-cell row. Colors identify the three individual columns. No corpus
artwork or third-party document engine is used in the generator.

The reference application exported `control.docx` read-only to `native.pdf`.
`tools/record_autofit_repeated_spans.py` reads the native PDF fill rectangles and
records source/PDF SHA-256 hashes. The reference application's individual column widths stay the same
across all eight cases, approximately 64.56/170.95/64.58pt.

Before the fix, reducing the working grid after each row caused each repeated
merged request to expand its last column again. The six-leading-row case moved
the final column's left boundary about 40pt left of the reference application. Deferring reduction
until all preferences have been resolved avoids that accumulation. An explicit
single-column request also replaces a share inferred from a merged cell; a
merged preference still constrains its complete span.

ECMA-376-1 fifth edition §17.18.87 describes AutoFit and fixed layout using
non-normative algorithm guidance and explicitly permits other processes.
§17.4.17 defines `gridSpan`, §17.4.48 the grid, §17.4.63 table preferred width,
and §17.4.71 cell preferred width. The reference application differs from a literal implementation of
the guidance's repeated intermediate reductions. This is an observed algorithm
difference, not a claimed contradiction of a mandatory conformance rule.

All eight native/application page pairs were inspected. Browser tests require
the 24 individual cells' X positions and widths to match the reference application within 0.2pt.
Unit tests verify invariance under repeated/reordered requests, long cell text
reflow, export/reopen, preservation of source preferences and unrelated parts,
and exact undo. Existing fixed/AutoFit, nested, overlapping-span, empty-indent,
cell-anchor and compatibility-mode controls are separate regression coverage.
