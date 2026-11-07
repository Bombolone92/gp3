# Section column flow: native controls for an open feature gap

These eight original, manually authored OPC packages contain Arial text and a
simple original table. They contain no private corpus content. Generate them
with `tools/column_flow_fixture.py`, export with the reference application using
`tools/column_flow_native.ps1`, and record native PDF text coordinates with
`tools/record_column_flow.py`. Current references were exported read-only with
the reference application after exact-path confirmation. Each reference binds DOCX and PDF
SHA-256 hashes. All eight sources pass the transitional schemas.

The page is 360 by 216 pt, with 36 pt margins. Equal columns are 126 pt wide,
separated by 36 pt. Unequal columns are 72 and 180 pt wide with the same gap.
Each paragraph has exact 18 pt line spacing and disabled widow control.

- `short`: five lines stay in the first column; the final section is not balanced.
- `equal-flow`: thirty lines flow through both columns and onto a second page.
- `unequal`: the second column starts at x=144 pt instead of x=198 pt.
- `separator`: the separator does not change the text coordinates or pagination.
- `explicit-break`: a column break advances to the second column on the same page.
- `wide-table`: a fixed 288 pt table extends beyond the first 126 pt column.
  Its two cell starts are approximately x=37 and x=181 pt, while following text
  resumes at the first-column origin. This is not evidence that body text should
  ignore column widths.

- `page-break`: an authored page break skips the remaining column and starts
  the next physical page.
- `table-flow`: ten two-cell rows flow seven rows in the first column and three
  in the second, followed by a paragraph in that second column.

ECMA-376 Part 1 sections 17.6.3 (`col`) and 17.6.4 (`cols`) define section
columns. Equal-width flow is connected to import, pagination, placement and
editing. Browser checks compare supported controls with these native references,
including hit testing, selection, edits, package preservation, exact undo and
reopening. Unequal widths, separator rules, explicit column breaks and floating
objects remain outstanding. Their references must not be presented as passing
runtime conformance. The final short section is not balanced by these references.
