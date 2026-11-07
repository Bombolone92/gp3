# Continuous paragraph shading

`tools/paragraph_shading_seams_fixture.py` derives this original OPC/XML control
from our original joined-border fixture. It adds opaque blue shading and uses
12.25pt line spacing to exercise fractional raster boundaries. It contains body
and cell cases, keep-next, contrasting 2pt red dividers, and adjacent differing
border sets whose touching 0.25pt edges have the same color as the shading.

The fixture was opened in the reference application, confirmed by its exact full path,
exported to the retained eight-page PDF, and closed without saving. The JSON
records its SHA-256 hash and baselines. At x=200pt, all samples between the first
and third bordered paragraph baselines are exactly RGB(34,68,102), except the
two contrasting-divider cases which contain that blue and RGB(204,51,0).
These samples were extracted from the native reference PDF rendered at two pixels per point.

ECMA-376 Part 1 §17.3.1.31 (`shd`) specifies the paragraph fill;
§§17.3.1.5, .7, .24 and .42 describe adjoining paragraph borders. This is a
Canvas raster coverage correction, not a reference/spec divergence or a layout
change. Independently alpha-blending abutting shapes against white creates
lighter pixels even when their combined opaque coverage is complete.

The painter fills consecutive same-color paragraph rectangles as one path.
It bridges a gap only where matching opaque single-border polygons cover that
entire gap, respecting cell clips and corners. Contrasting/patterned borders
and actual spacing remain separate. Border painting order and logical shading
bounds remain unchanged for the remaining ink. Already-filled interior ink is
subtracted from the later border bands so fractional alpha rounding cannot
darken it on a second pass. Unit controls reject incomplete, clipped, contrasting
and patterned coverage. Browser checks reproduce the old blending defect,
check the native reference fixture at device scales 1, 1.25 and 2, and verify edit/export,
reopen and exact undo.

Vertical-edge follow-up (2026-09-26): matching solid vertical border portions
and adjoining shading now share one fill path, including clipped corner
polygons. A conflicting overlapping fill prevents this change of paint order.
The later border pass subtracts the absorbed band so it is not blended twice.
Contrasting and patterned borders remain separate. Geometry and saved XML are
unchanged. The existing original reference control's first page has blue interior
shared edges at x=24.60pt and x=587.52pt; at y=75pt and 384dpi both are exactly
RGB(34,68,102). Browser coverage includes that native check, left/right edges
at four scales, cell clipping, corners, and conflicting fills. This extends the
same raster-coverage correction; it introduces no reference/spec divergence.
