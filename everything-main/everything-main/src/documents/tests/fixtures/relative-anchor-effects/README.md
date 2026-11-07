# Relative anchor effect-box offsets

These original controls are generated directly as OPC/XML by
`tools/relative_anchor_effects_fixture.py`, using the project's independently
authored shape fixture. They contain no corpus artwork or third-party fonts.
Both sources pass transitional/MCE and supported extension schema validation.

Each source contains eight objects: rectangles positioned relative to the page
and ellipses positioned relative to the margin. The four rows have fixed sizes,
relative width only, relative height only, and both relative dimensions. All
have deliberately asymmetric effect extents: left 5, top 7, right 11, bottom
13 pt. The ordinary shape is 200 by 90 pt. Percentage dimensions are 30% of
page width and 10% of page height. `cell.docx` repeats the same objects inside
one table cell with zero padding.

The reference application uses numeric offsets for the shape origin when both dimensions
are fixed. When either dimension is relative, it adds both the leading effect
extents to the numeric position. Thus even a width-only percentage moves the
vertical origin by 7 pt, and a height-only percentage moves the horizontal
origin by 5 pt. Only the relative dimension subtracts its pair of effect
extents. The cell version follows the same rule after cell-relative placement.

The first-column native frames, in top-left page points, are:

| Sizing | Body frame x, y, width, height | Cell frame x, y, width, height |
| --- | --- | --- |
| Fixed | 60, 100, 200, 90 | 96, 160, 200, 90 |
| Width only | 65, 247, 167.6, 90 | 101, 307, 167.6, 90 |
| Height only | 65, 387, 200, 59.2 | 101, 447, 200, 59.2 |
| Both | 65, 527, 167.6, 59.2 | 101, 587, 167.6, 59.2 |

`reference.json` records both source/PDF hashes, all eight vector path
bounds and native raster ink bounds. PDFs were exported from the exact sources
in the reference application. Refresh these measurements with
`python tools/record_relative_anchor_effects.py` only after native recapture.

This is an observed native refinement of `wp:positionH`, `wp:positionV`,
`wp:effectExtent` and the `wp14:sizeRelH`/`sizeRelV` extension. The base standard
does not define those percentage-size extensions; no new contradiction with
normative OOXML text is asserted. Existing aligned-position controls separately
cover their effect-box placement. Sub-tenth-percent rounding and resampling of
relative-sized shape strokes remain separate questions; these controls use exact
whole percentages and do not change the shape rasterization path.

Validation: 58 distinct focused unit tests and 25 browser cases pass, including
existing modern/legacy anchor placement, cell flow, percentage-sized groups,
header/footer drawing and paragraph-anchor regressions. Both final source
packages, 43 exports from the broad browser run, four final control exports and
eight final corpus exports pass schema checks. Production build/license checks
pass. The first cell browser comparison exposed unspecified title font metrics;
the final sources use explicit Arial and exact line spacing to keep the table
origin independent of font fallback. Final native references were recaptured.
