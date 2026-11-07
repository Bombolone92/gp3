# Complementary compound-border corner controls

`tools/mixed_compound_border_fixture.py` authors original OPC/XML using the
project's independent inline-baseline package scaffold. Each of 64 pages pairs
paragraph and table borders: all sixteen thin/thick side-order combinations,
both frame values, and small/medium gap families, at 36 eighth-points. Every
side has a distinct color, so the reference distinguishes corner connectivity
from overlap ownership. No corpus artwork or content is copied.

The reference application exported `control.docx` as the 64-page `native.pdf`.
`tools/compound_border_variants_reference.py --mixed` records source/PDF hashes
and all 3,072 filled PDF rectangles, including drawing order and RGB colors.
It verifies that the five path vertices describe four axis-aligned rectangle
corners before using their bounds. This avoids treating arbitrary polygons as
filled rectangles.

The reference application joins corresponding outer/inner bands when adjacent edges reverse
thin/thick order within the same gap family and use the same size. Horizontal
color owns each overlap. The old equality check on style names incorrectly
stopped the vertical ink at these corners; 112 of the 128 paragraph/table
comparisons failed before the change. All 128 now pass the same point samples
and the same 0.15pt edge exclusion, with both ink and color compared. This
exclusion isolates raster/600dpi rounding boundaries; it is not a claim of
pixel identity at those boundaries. The same browser test checks text editing,
unrelated-part preservation, exact no-edit/undo packages and edited reopening.

ECMA-376 Part 1 §§17.4.38, 17.4.66 and 17.18.2 define the border elements and
styles. Their descriptions do not numerically prescribe these mixed-order
corner joins, so this is native compatibility evidence, not a newly asserted
reference/spec divergence. Cross-family joins, unequal sizes and T/cross junctions
keep their existing behavior; this fixture does not certify every such case.

Validation also includes the older size/frame/color/corner controls. On the
original illustrated-story specimen, the top-right and bottom-left gaps close;
only 71 pixels at those corners change at 96dpi. Native PDF versus screen
subpixel edge/cap rounding remains a separate calibration question.
