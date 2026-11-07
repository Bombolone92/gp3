# Local recovery for rotated table cells

`tools/rotated_cell_recovery_fixture.py` constructs ten original OOXML packages
from the original `cell-text-direction/control.docx` control. It uses only Python
standard-library XML/ZIP operations, independently of the renderer/exporter.

Five paired cases exercise unsupported rotated cells before/after healthy cells,
two simultaneous failures, a nested table inside a rotated cell, and header/footer
tables. Each matched control changes only the affected cell's `textDirection` to
`lrTb`; it retains `hideMark` or the nested table. Healthy `btLr` and `tbRl` cells
remain. Three body pages allow checks for damage beyond the failing table.

ECMA-376 Part 1 §17.4.72 defines cell text direction; §17.4.21 defines `hideMark`
and its role in row height. The supplied specification was read at PDF pages 415
and 477. These combinations are valid OOXML. Horizontal display is an explicitly
reported read-only approximation, not their specified rendering and not a claim
of a reference/spec divergence. Full rotated hidden-mark/nested-table support remains
open. No native reference is needed to prove the narrower recovery invariant:
unrelated cells must retain their already-supported geometry and glyph pixels.

Unit checks compare geometry with the independent controls and verify unchanged
model/package parts. Browser checks compare all page pixels and body/story line
geometry at 100% and 75%, retain healthy rotations, exercise multiple failures,
inspect localized diagnostics, reject edits and verify original-byte downloads.
Existing native rotated-cell geometry, painting and editing controls remain the
reference for the supported rotation paths.
