# Independent inline picture extent investigation

The generator `tools/inline_picture_extent_fixture.py` creates 24 original
controls using python-docx and our original four-color PNG from
`public/fixtures/group-picture-flips.docx`. No corpus document is copied.
Each picture is 40 by 70 points, between Arial 12pt Left/Right labels, followed
by an After paragraph. The reference application confirmed the exact source path and
exported the seven-page PDF. All seven pages were inspected in a contact sheet.
The source passes the standard and extended XML schema checks.

`tools/record_inline_picture_extents.py` records raw native PDF text origins
and image matrices with pypdf. Hashes bind the source, case manifest and PDF.
No engine coordinates are used to generate or adjust native observations.

The reference application swaps reserved width/height at normalized angles [45,135) and [225,315).
At 44.999 degrees the reserved frame is 40 by 70 points; at 45 it is 70 by 40.
Ink rotates continuously around the frame center. Pixel comparisons and PDF
clipping paths correct the initial matrix-only inference: The reference application clips vertical
overflow to the complete line box, including its descent, while horizontal
overflow remains visible. Declared effect extents add to the reserved frame. Missing effects
behave as zero in these controls, not as calculated rotated-corner outsets.
Negative and multiple turns, flips and source cropping preserve this convention.
Cases cover all four boundaries, asymmetric effects, oversized effects and
omitted effects. Text coordinates have PDF quantization of roughly 0.15pt.

These observations contradict the current engine's inline rotated-corner
reservation guard. They do not by themselves establish a reference/spec divergence.
The recorder also samples native pixels through installed Poppler. A sample is
retained only when its 9-by-9 neighborhood is uniform; every case has at least
four samples. Browser checks compare native text positions, picture centers
and these pixels, including clipping, before and after body edit/export/reopen.
Unit coverage checks visible horizontal overflow, clipped vertical ink,
selection bounds, image edits and exact undo. The evidence-only test remains
separate from renderer checks.
