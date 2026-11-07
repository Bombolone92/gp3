# Dense custom path native reference

Original OPC/XML authored by `tools/canvas_dense_path_fixture.py`, using the
Python standard library and original fixture constants. The visible polygon
has 16,384 line segments on an elliptical frame, plus its initial move and
close command. No user artwork or third-party renderer is embedded.

The exact fixture was opened in the reference application and exported to
`native.pdf` without saving. `tools/dense_path_reference.py` extracts eleven
ink cross-sections at 288 dpi and records the source SHA-256. Browser checks
compare these within 0.75pt after import, surrounding text edits, export/reopen
and complete undo, retain every segment and compare all ZIP entries after undo.
The native browser reader also checks command count and quadrant coordinates.

Before the fix, this exact fixture failed editable import with
`grouped drawings with excessive path points`. Part 1 section20.1.9.15 and
Annex A.4.1 allow an unbounded command sequence. Removing that arbitrary cutoff
retains the existing package, object/depth and bitmap resource limits. This
fixture does not establish unlimited resource capacity or pixel-identical font
rasterization.
