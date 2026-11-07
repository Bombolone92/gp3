# Native table-cell break controls

These are independently authored OOXML controls from `tools/cell_break_fixture.py`,
using the project's original OPC skeleton. No corpus content is copied.
`tools/export-reference.ps1` exported each source through the reference application;
`tools/record_cell_breaks.py` records page text, rendered PNGs and source/PDF/PNG
hashes. All seven native pages were visually inspected. All six source packages
pass schema validation (12 XML checks, actual exit zero, no failures).

Observed behavior in the first cell of an ordinary two-column table:

| Case | Native result |
| --- | --- |
| `line` | Before and After occupy successive lines. One page. |
| `page` | Inline page break has no visible width or line/page advance: BeforeAfter. One page. |
| `column` | Inline column break likewise produces BeforeAfter. One page. |
| `empty-page` | A separate paragraph containing only a page break retains one empty paragraph line. One page. |
| `before-first` | pageBreakBefore on the cell's first paragraph moves the entire table to page two. |
| `before-second` | pageBreakBefore on the cell's second paragraph leaves it on page one. |

The four inline-break controls now have browser comparisons of native text
origins and baselines (within 0.2pt), plus insertion next to the control, exact
no-edit/undo preservation and editable export/reopen. The recorder also retains
native label positions. Unit controls cover zero-width caret offsets, inserted
breaks, automatic table sizing, whitespace, justification and oversized text.

Compatibility divergence: ECMA-376 Part 1 §17.3.3.1 (`br`, referring to
§17.18.4 `ST_BrType`) describes advancing subsequent text according to the break
type; the reference application instead suppresses inline page/column breaks in these cells. The
engine follows the reference application while preserving the original XML and editable offsets.
Ordinary text-wrapping breaks still advance a line. Paragraph-level
§17.3.1.23 (`pageBreakBefore`) is distinct and remains guarded: the first/second
paragraph controls show why it cannot be treated as an invisible inline break.
These fixtures do not establish exhaustive merged/nested-table pagination.
