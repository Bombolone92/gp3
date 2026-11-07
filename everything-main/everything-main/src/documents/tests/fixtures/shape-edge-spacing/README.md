# WordprocessingShape paragraph edge spacing

`tools/shape_edge_spacing_fixture.py` creates original OOXML controls using the
project's own drawing constructor and base package. The reference application
exported the three-page PDF without saving the DOCX. The 21 controls cover
top/center/bottom anchoring; omitted, false and true `spcFirstLastPara`; separate
before/after spacing; two paragraphs with collapsed interior spacing; and zero
spacing baselines. Text is Arial 24pt with exact 24pt line height and 6pt insets.

The reference application retains WordprocessingML paragraph edge spacing in all three flag states.
For example, the bottom-aligned single paragraph with 18pt after-spacing is 18pt
higher than its zero-after counterpart, including with `spcFirstLastPara="0"`.
This differs from applying the DrawingML `a:p` rule in Part 1 §21.1.2.1.1 to
WordprocessingShape's `w:txbxContent`.

`record_shape_edge_spacing.py` independently extracts PDF baselines and measures
colored ink bands at 288dpi. Unit tests compare physical baselines within .15pt;
browser tests compare actual painted baselines within .15pt, compare painted
ink with native glyph bounds at the native reference baselines within 1pt (including frame
clipping), and preserve drawing XML through
body edits, export/reopen, and exact-package undo. Source/PDF hashes accompany
the measurements. This establishes the existing no-autofit horizontal text-box
subset, not general DrawingML text-body layout or vertical/autofit behavior.


The browser test runs both the original font declaration and a deliberately
missing family. The reference application's Arial PDF ink comparison additionally runs when the
actual local Arial face is installed. A Linux CI run reported E11 ink bands at
263–284.25pt and 305–326.25pt, versus the reference application's 262–284.25pt and 304–326.25pt;
that alone does not establish a baseline error. Local direct paint captures
with Arial and bundled Noto Sans both retain the native reference baselines within .15pt,
while glyph ink differs. The test now distinguishes those checks rather than
requiring a substituted font's outlines to equal Arial or widening tolerances.
The missing-font case also checks the text frame's bottom clipping. This does
not resolve the separately recorded corpus font-substitution fidelity gap.

A later Linux run exposed another oracle mismatch: untransformed 32px
`TextMetrics` differed from ink rasterized under the shape's 2× transform by
1.08pt. The native-font comparison now independently rasterizes the captured
font/text at the native reference baseline with that raster scale, frame clip and the same
ink threshold. The .15pt baseline and 1pt ink tolerances are unchanged, and
the direct native-reference Arial comparison remains enabled where Arial is available.
This changes the test oracle, not document layout or painting.
