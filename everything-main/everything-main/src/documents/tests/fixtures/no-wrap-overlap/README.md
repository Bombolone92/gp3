# No-wrap drawing collision controls

Original source: `tools/no_wrap_overlap_fixture.py` (solid images and document
content authored for this project). `native.pdf` was exported read-only by
the reference application. `manifest.json` records source/reference
hashes. No corpus content or third-party document engine is included.

Twenty-two pages cover both overlap permission values, foreground/background,
mixed layers, identical and partially intersecting rectangles, either relative
position, exactly touching edges, and the physical right-page boundary.
`reference.json` records image transformation matrices from the PDF in
points, measured from the page top, plus PDF painting order. Raster edges may
be rounded differently and must not replace these geometric references.

ECMA-376 Part 1 20.4.2.3 says a drawing that cannot overlap another drawing must
be repositioned. The reference application moves the later source drawing right, or down if moving
right would exceed the physical page edge, when either member prohibits overlap.
This applies across foreground/background layers. Source offsets stay unchanged.
The reference application leaves a one-twip overlap at the new edge: a measurable divergence from
strict non-intersection, reproduced by these independent controls.

The layout fix covers no-wrap floating frame collisions. Interactions requiring
text-wrapping displacement remain guarded. More complex collisions (including
cross-story objects, inline drawings, effects, rotated groups, and movement past
the physical page bottom) still require native controls. These controls also
expose an existing foreground paint-order difference on page 1 where both
objects permit overlap; geometry tests do not claim to resolve that separate
stacking issue.
