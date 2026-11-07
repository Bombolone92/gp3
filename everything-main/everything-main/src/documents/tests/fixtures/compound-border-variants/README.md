# Small/medium-gap compound border reference controls

These controls anchor paragraph/table support for the three compound styles
found in corpus #246. Unit and browser regressions compare their measured ink,
gaps, corner joins and frame behavior and exercise editing/export/undo.

`tools/compound_border_variants_fixture.py` manually authors OPC/XML using only
the existing original inline-object-baseline package scaffold. No corpus art,
third-party engine or external font is bundled. `control.docx` passes the
repository's transitional/MCE schema checks. The reference application exported
the 42-page `native.pdf`; each page pairs a paragraph and one-cell table with all
four border sides. Cases cover three styles, sizes 0/2/8/13/24/48/96 eighth-points
and frame off/on. `cases.json` defines the order; the independent PDFium recorder
`tools/compound_border_variants_reference.py` retains colored path bounds,
horizontal band measurements and source/PDF SHA-256 in `reference.json`.

Observed top bands, in points (same for paragraph and table):

| Style | First ink band | Gap | Last ink band |
| --- | --- | --- | --- |
| thinThickSmallGap | full width | 0.72 | 0.72 |
| thickThinSmallGap | 0.72 | 0.72 | full width |
| thickThinMediumGap | half width | half width | full width |

At sizes 0, 2, 8, 13, 24, 48, 96, observed full widths are
0.12, 0.24, 0.96, 1.56, 3, 6, 12 pt; half widths are
0.12, 0.12, 0.48, 0.72, 1.44, 3, 6 pt. These agree with separately flooring
the declared full/half widths to 0.12 pt units, with a one-unit minimum.
The measurements, not this inferred formula alone, must anchor renderer tests.
Full paths retain corner/vertical/frame behavior for follow-up validation.

ECMA-376 Part 1 §17.18.2 defines ST_Border. MS-OI29500 documents a correction
to the thinThickSmallGap description (two strokes, not three):
[MS-OI29500 §2.1.528](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/923382bf-235a-4f4a-b9df-d5a0f8b2ead8).
The independent two-band reference controls demonstrate that divergence.

PDF coordinate serialization contributes up to 0.024 pt width differences;
unit comparisons allow 0.03 pt. Corner comparisons exclude points within
0.15 pt of either renderer's ink boundary, retaining interior/gap samples.
