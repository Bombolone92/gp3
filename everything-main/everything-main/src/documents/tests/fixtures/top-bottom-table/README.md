# Tables above or below a wrapping band

Generated as original OPC/XML and PNG by `tools/top_bottom_table_fixture.py`.
Three pages place one-, three- and six-row fixed-layout tables after a drawing
anchor. Each row is exactly 10 pt high. The drawing occupies the paragraph-
relative band from 26.8 to 126.55 pt. Cell margins are zero.

The native reference leaves the one-row table above the picture. The larger tables move
as complete tables below it; they do not split their initial rows above the
picture. The following body paragraph independently clears the remaining band.
`native.json` records all sixteen text baselines and source/reference hashes
from the 2026-09-30 native Save As PDF export. The PDF remains private.

Run `tools/check-top-bottom-flow.mjs URL table` or the browser test in
`top-bottom-flow.spec.js`. The browser test includes editing, package
preservation, exact undo and reopening. Coverage is finite: these are ordinary
body tables with fixed heights, not proof of every nested/floating/merged-table
interaction. Relevant standard families: ECMA-376 Part 1 §§20.4.2.20, 17.4.
