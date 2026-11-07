# Contextual spacing at table row boundaries

Original XML controls authored by `tools/cell_row_context_fixture.py` and
`tools/cell_row_context_merge_fixture.py`. The generators use no corpus artwork
or third-party document engine. The reference application exported the sources
read-only to their corresponding PDFs. `tools/record_cell_row_context.py` reads
PDF character origins and records source/reference hashes independently of the
application.

`control.docx` has 18 pages: top/center/bottom alignment, one/two columns, and
plain/direct-numbered/style-numbered paragraphs in three 40pt rows. Each cell
uses the same paragraph style with contextual spacing and 6pt before-spacing.
The reference application preserves that spacing at the first cell of each new physical row, but
suppresses it between same-style cells within a row. This holds for all three
numbering variants. Before the correction, the app incorrectly compared the
first cell of later rows with the preceding row's last paragraph.

`merge.docx` has two additional pages. The first column spans three rows; empty
continuation paragraphs either use Shared or the default paragraph style.
The reference application uses that otherwise invisible paragraph's style when comparing the next
cell in the row. Treating the first *visible* cell as a new row would incorrectly
change the Shared case. Import therefore retains the continuation's final
paragraph style ID, and merge/split operations maintain or clear that metadata.

ECMA-376-1 fifth edition §17.3.1.9 describes preceding/following same-style
paragraphs, without spelling out this physical-row boundary. The row reset is
a reference-specific interpretation of that context, independently demonstrated here;
it must not be implemented as an offset for a particular source. §17.4.83 covers
vertical alignment, and §17.4.84 covers vertical merges. Existing compatibility
and within-row spacing behavior remains covered by separate native controls.

All 20 native/application page pairs were inspected. The 89 cell-text positions
match within 0.2pt in browser tests. Unit tests also cover numbered/unnumbered
rows, new vertical merges, splitting imported merges, preserved styles and
unrelated package parts, export/reopen layout, and exact undo. Browser scenarios
exercise editable loading, text edits, undo, export and reopening. No source
paragraph properties are rewritten to materialize the measured spacing.
