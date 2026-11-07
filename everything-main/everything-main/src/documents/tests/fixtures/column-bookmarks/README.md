# Independent table-column bookmark controls

`tools/column_bookmark_fixture.py` creates six original 3-by-3 tables with
native `bookmarkStart`/`bookmarkEnd` elements and explicit `colFirst`/`colLast`.
They cover a middle column, two columns, one cell and a horizontally merged
first-row cell, plus collapsed cell-block and inline points. The source passes
standard and extended schema validation. The companion `collapsed.docx` retains
the same table content with only the two collapsed bookmarks; its separate
native reference records their behavior without the active-column controls.

`tools/record-column-bookmarks.ps1` opens the exact source read-only in an owned
hidden reference application instance, confirms its FullName, repaginates, records bookmark ranges,
calls each bookmark's native Select method, records the selected cells, and
exports the PDF. The reference application reports one page. Source and PDF hashes bind the
observations in `native-ranges.json`. No source save occurs.

The reference application reports `Bookmark.Column=true` and selection type 4 for the four active controls.
The middle-column bookmark's linear Range includes seven cells, while Select
chooses three cells. The two-column Range contains eight cells, while Select
chooses six. Therefore a single contiguous text range does not reproduce native
column selection. The merged-top control selects the third logical grid column
down all rows: the first row's second physical cell is the first selected cell.
The later boundary/merge controls below establish the corresponding region rule.

The reference application reports Column=false, selection type 1 and equal start/end positions for
both collapsed controls. The initial implementation imported these as point
bookmarks, retaining attributes while guarding noncollapsed ranges. The later
active-column implementation below replaces that guard.
Unit tests cover typing, paragraph splits, row/column insertion/deletion,
rename/removal and exact undo; a browser test navigates to the point, inserts
text, exports, undoes and reopens it. Reopening that edited package in the reference application
retains both collapsed ranges with Column=false.

The controls vary marker placement within rows; the merged observation is not
a complete implementation of arbitrary column selection. No normative reference/spec
contradiction is asserted from these first six observations; the later bounds
controls below establish specific divergences.

## Merged-row and endpoint controls

`tools/column_bookmark_merge_fixture.py` creates `merge-control.docx`: twelve
original tables, one per page, varying horizontal-merge placement, the first
and last bookmarked rows, column attributes, inline markers and a table-level
end marker. `merge-cases.json` records the source configuration. The same native
recorder produces `merge-native.pdf` and `merge-native-ranges.json`; hashes bind both
artifacts, and the source passes all ten standard/extended XML schema checks.
`tests/column-bookmarks-merged-native.test.js` checks source marker/merge
configuration and all selected cell texts, not just selection counts.

The reference application reports twelve pages and twelve active column selections:

- With an unmerged first bookmarked row, `colFirst=colLast=1` selects its second
  cell and the corresponding middle-column cells below. A later merged cell
  covering columns one and two is included, without expanding the selection in
  the remaining unmerged rows.
- With the first two cells merged in the first bookmarked row, `0..0` selects
  that merged cell and both corresponding columns in later rows; `1..1`
  selects the third grid column throughout; `0..1` selects all cells.
- Starting after an earlier merged row uses the unmerged start row. Starting
  on the merged middle row uses that row's physical cells. Ending before a
  merged row excludes it.
- Inline markers produce the same whole-cell middle-column selection as
  cell-block markers. A bookmark ending directly under the table includes its
  last row, matching the structural endpoint needed by corpus document 368.

These observations support resolving the horizontal region from physical cells
in the first bookmarked row, then intersecting later rows with that region.
They rule out independently applying physical-cell indices to every row and
directly interpreting the attributes as grid indices. This is an inference
from the controls, not a complete rule for arbitrary table geometry: unequal
cell widths, grid offsets, vertical merges, nested tables and invalid indices
still need native controls. The reference application's enclosing linear Range is also distinct
from the cells selected by Bookmark.Select; neither can substitute for the
other in editing or structural rebasing.

Local ECMA-376 Part 1 fifth edition §17.13.6.2, printed pages 910–913, defines
zero-based columns in a row and row endpoints, but does not explicitly resolve
the horizontal-merge cases above. These controls refine native compatibility;
they do not establish a normative contradiction. Production active-column
editing was still guarded at that evidence checkpoint. The later implementation
now resolves and tracks covered cells separately from the marker interval.

## Bounds, vertical merges and nested geometry

`tools/column_bookmark_limits_fixture.py` creates ten source controls. The final
native artifacts are `limits-native.pdf` and `limits-native-ranges.json`.
`tools/column_bookmark_geometry_fixture.py` creates six more controls with
vertical merges, a start in a continuation row, a nested table, an omitted
leading grid cell and unequal grid widths. Its artifacts use `geometry-native`.
Both source packages pass ten XML schema checks each.

The bounds controls prove a reference/spec divergence: ECMA-376 Part 1 §17.13.6.2
requires ignoring reversed/out-of-range hints and applying the bookmark to the
whole table. The reference application clips oversized last indices, lowers a reversed first index
to the last index, and returns an empty column selection for a first index
beyond the physical row. Negative hints produce an ordinary range. These
behaviors are implemented and tested against the hash-bound native records.

For vertical merges, the reference application selects each owner once and excludes owners beginning
above the first bookmarked row. Thus `StartInContinuation` selects only R3C2;
`VerticalMiddle` selects the R1C2/R2C2 owner plus R3C2. NestedMiddle includes its
inner table content as part of the covered outer cell. OmittedFirst indexes
physical cells after the omission and selects grid column three in all rows.
UnequalGrid retains the expected middle-column selection.

The native recorder now uses indexed Cells access with its recorded Count.
COM enumeration on the negative-index controls otherwise yielded stale cells
from a previous selection despite Count=0; those exploratory records are not
the final references. Production import, structural tracking and navigation are
tested in `active-column-bookmarks.test.js`, `column-bookmarks-geometry.test.js`
and `browser/active-column-bookmarks.spec.js`. New column-bookmark authoring and
a visual rectangular selection UI remain separate work.
