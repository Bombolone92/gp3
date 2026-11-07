# Thin solid DrawingML fills

All seven DOCX files are independently authored by
`tools/solid_fill_display_fixture.py` using original XML and Python's standard
library ZIP writer. They contain no embedded fonts, images, third-party artwork,
or proprietary engine output. Regeneration is deterministic.

The controls vary positive rectangle thickness and quarter-pixel position in
both orientations. `control.docx` uses default compatibility behavior;
`boundary.docx` uses compatibility mode 15 and widths around whole-twip/device
thresholds. `horizontal.docx` rotates the layout of the test rectangles without
rotating the shapes. The four group controls use child coordinates scaled by
two horizontally and three vertically. Two also translate the outer group by
0.35 points in each direction.

The native reference observations distinguish these screen behaviors:

- Positive subpixel filled rectangles retain at least one device pixel.
- Standalone shapes project whole-twip physical extents independently of origin.
- Group children project their near and far edges separately, after rounding
  the group's outer position to the screen device grid.

ECMA-376 Part 1 §§20.1.7.1–6 describes physical/child transforms,
§20.1.8.54 solid fill, and §§20.1.9.15, 20.1.9.18 shape paths/preset geometry.
The accompanying preset rectangle definition establishes the continuous path.
These clauses do not prescribe the above screen pixel rounding. The references
record native display compatibility behavior, not a normative OOXML violation or
a replacement for physical print coordinates.

`reference.json` binds each original fixture to its unchanged owned reference
copy, screenshot hashes, observed page origin and native footprint profiles.
The native PNGs are unscaled analytical crops of the independently authored
controls; they exclude application chrome, overlapping tooltips and the insertion
caret. Their upper-left corner is 70 pixels below the observed page origin;
`cropPageOffset` records that fixed, unscaled crop. The source screenshots are JPEG, so
their median cross-sections establish pixel footprint, not exact opacity or
color. The viewer must retain the original opaque RGB fill. Sampling uses the
authored integer EMUs and an independently observed page edge; no alignment is
fitted to artwork. `tools/record_solid_fill_display.py` recreates the numeric
reference from private observations and candidate renders.

Print hashes come from the explicitly routed `c6b7078e` shape renderer and are
checked against the candidate. Screen rounding must not change print pixels,
body geometry, editability, retained package parts, exact undo or reopening.
The browser suite checks those behaviors and canvas clipping/state/fallbacks.
The current native footprint reference covers 100% zoom at DPR 1; it does not
certify arbitrary zoom, color/alpha equivalence, all drawings or maximum-size
performance.
