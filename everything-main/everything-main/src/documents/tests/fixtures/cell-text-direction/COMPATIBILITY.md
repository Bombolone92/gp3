# Rotated-cell margins across reference compatibility modes

`mode14.docx` and `mode15.docx` reuse the independently authored eight-page
`control.docx`. Their document content is identical; each adds a relationship-
resolved settings part selecting the named compatibility mode. Generate them
with `tools/cell_text_direction_compatibility_fixture.py` and capture their native reference
PDFs with `tools/export-reference.ps1`. `tools/record_cell_text_direction.py`
records native text matrices and binds the references to source/PDF hashes.
No corpus text, artwork or document-specific offset is used.

The paired controls cover horizontal and both quarter-turn directions, top,
center and bottom cell alignment, paragraph alignment, multiple paragraphs,
wrapping, automatic/minimum/exact row heights, and asymmetric explicit margins.
The reference application exports eight pages for each mode.

## Reference behavior and the specification

ECMA-376 Part 1 §§17.4.42 and 17.4.68 define table/default and cell margins;
§17.4.72 defines rotated cell text flow; §17.4.83 describes alignment between
the container margins. The reference application's legacy mode-14 behavior ignores the trailing
cross-axis margin when centering/bottom-aligning quarter-turn text, ending at
the inner border instead. Mode 15 reserves that margin. This legacy departure
from margin-bounded alignment is preserved only for the earlier compatibility
modes; the previous engine incorrectly applied it to modern documents too.
The original no-settings controls retain the legacy behavior. This observation
does not change style inheritance or claim support for East Asian vertical modes.

The engine now uses the resolved section/page compatibility mode for the rotated
frame. This changes only the cross-axis alignment; row allocation, reading-axis
extent, top alignment and source OOXML are unchanged. Overflow remains aligned
to the leading edge. The same frame drives painting, hit testing and selection.

Browser checks compare the native coordinates at the existing 0.15pt X / 0.2pt Y
tolerances. Mode-15 painting also verifies clicks, caret/selection clipping,
keyboard navigation, typing, edited reopening, unrelated-part preservation,
exact package undo and restoration of page rasters. The existing automatic
baseline expected failures in `height` and `origins` remain explicit.
