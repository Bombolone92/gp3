# Persistent cell-control editing probes

Native behavior is recorded below. The source is
manually authored OPC/XML from `tools/persistent_cell_control_fixture.py`, using
only the existing original persistent-block-control package scaffold. It has
eight separate two-cell tables, each with a persistent rich-text control around
the first cell and an ordinary neighboring cell. Cases cover insertion,
replacement, complete content deletion, paragraph splitting, character
formatting, multi-paragraph placeholder replacement, explicit temporary=false
and ordinary multi-paragraph replacement. The source passes the transitional
schema validator; this alone does not prove reference behavior or engine support.

`tools/record_persistent_cell_controls.ps1` uses its own reference-application instance,
opens a disposable writable copy, verifies its path and editability, and records
each native operation and whether the wrapper/placeholder survives. Cell
terminators are excluded from text replacements. Per-case errors are recorded
rather than interpreted as successful edits. `-SaveEditedPackage` and
`-ExportPdf` opt into native file output after recording behavior; both native
file-output calls stalled during this investigation, so no saved edited package
or PDF is claimed as evidence. The default behavior-only run completes.

`native-results.json` records the reference build and the exact source SHA-256.
All eight operations completed without error, retaining one wrapper each.
Deleting all content restored five spaces and `ShowingPlaceholderText=true`.
Splitting retained two paragraphs inside the same control. Replacing a
multi-paragraph placeholder removed the whole cache and cleared placeholder
state. Formatting retained the wrapper and text.

`tools/record_persistent_cell_structure.ps1` opens a fresh disposable copy per
operation. `native-structure-results.json` includes native table/control text,
counts, errors, and the exact wrapper XML from `Range.WordOpenXML` before/after.
The reference application preserves the source cell wrapper on open (`tr/sdt/sdtContent/tc`).
Merging the controlled first cell with its ordinary neighbor converts it to
a block wrapper inside the merged cell (`tc/sdt/sdtContent/p`), enclosing only
the original text. The neighbor must remain outside the control. Reversing
the COM Merge arguments gives the same result; this does not test a source
whose control is in the right-hand cell. Splitting the controlled cell retains
one cell wrapper and creates an ordinary empty cell. Deleting its only row
removes the table and that control, leaving the seven other tables.
The vertical-merge case first adds an ordinary second row through the reference application and
writes `Lower neighbor` into its first cell. Merging down likewise converts
the cell control to a block control around only `Alpha beta`.

These are observed editing semantics, not a demonstrated reference/spec divergence.
OOXML wrapper type changes must be represented explicitly by the editor.

Engine regressions in `tests/persistent-cell-controls.test.js` and the matching
browser test cover text edits, serialized placeholder state, horizontal/vertical
merges, grid-span splitting, row/column/table deletion, new rows/columns, promoted
merged rows, search replacement, unchanged parts, undo and reopen. The spanning
split test uses an independently modified two-column span, because the editor's
existing split command splits grid spans rather than creating new grid columns.
Nested tables/block controls, separately controlled vertical continuations,
and locked/bound controls remain unsupported; table
insertion inside a persistent control rejects before mutation.
