# Original top-bevel controls

`tools/picture_bevel_fixture.py` authors these packages from the repository's
original four-color picture fixture, with an original coordinate-gradient PNG.
No corpus artwork or third-party document engine is included.

- `source.docx`: 23 pages spanning defaults, explicit sizes, asymmetric circle
  bevels, angle bevels, both perspective directions, ellipse geometry, extrusion,
  outline and contour combinations, zero dimensions, oversized bevels and
  coordinate-coded texture mapping.
- `lighting.docx` (`--lighting-only`): eight angle-bevel controls distinguish all
  four sloped faces with threePt/twoPt and omitted/0/120/270-degree rig rotation.
- `density.docx` (`--density-only`): twelve curved controls vary physical size,
  aspect ratio and rig rotation independently of the source document.

The reference application opened the exact original paths read-only and exported the PDFs.
`tools/picture_bevel_reference.py` (same mode flags) records source/PDF SHA-256,
288-DPI page samples and geometry, and native embedded-raster profile samples.
The source images inside these PDFs are approximately 200 DPI. Every page label
is checked before recording measurements. Captures do not save the DOCX files.

## What the native controls establish

ECMA-376 20.1.5.4 / CT_Bevel defaults are 76200 EMU for both dimensions and
`circle` for the preset. Both dimensions use ST_PositiveCoordinate, whose maximum
is 27273042316900 EMU, not the 32-bit coordinate maximum. The original omitted
and explicit-default controls render alike.

MS-OI29500 2.1.1269 describes height from the top face; 2.1.1316 gives the circle
cubic `(0,0), (0,.55627), (.44373,1), (1,1)`. Its prose labels X as height and Y
as inset. The asymmetric wide/tall native controls instead match X as inset and
Y as height. The renderer follows those observed axes. Perspective controls
also establish that the front face stays at the reference plane while the bevel
base moves backwards. Gradient controls retain the original texture mapping;
the inner face does not receive a separately stretched copy of the texture.
Zero height is flat; zero width with positive height retains a vertical wall.

The prototype approximates the curve with a bounded subdivision and interpolates
unclipped illumination before applying texture and clipping RGB. This is an
approximation validated at preview density, not a claim to reproduce the reference application's
internal tessellator or arbitrary-resolution output exactly.

## Reference compression and resolution limits

The reference application selectively writes JPEG (`/DCTDecode`) instead of lossless `/FlateDecode`
images. Native profile checks initially failed for source/oversize and
density/circle-24-24. Inspection found JPEG chroma ringing in precisely those two
profiles. The references now record the encoding: lossless profiles check all
RGB channels; JPEG profiles check encoded-RGB luminance (0.299R+0.587G+0.114B),
with the same four-level tolerance and one-native-texel placement allowance.
The independent lossless curved and four-face lighting controls check color.
JPEG luminance checks do not establish exact chroma fidelity.

ExportAsFixedFormat2 with OptimizeForImageQuality still emits JPEG in these
cases. The reference application's Range.EnhMetaFileBits instead supplied lossless embedded PNGs for
source pages 4/14 and density page 5; the three `word-*-600dpi.png` files retain
those original images. The EMF+ header reports 600 DPI; each raster is 1205×905.
These captures are diagnostic, not interchangeable PDF references. The reference application changes
the highlight with output density: at approximately 1.18pt inward on the small
rotated top bevel, the 600-DPI blue-quarter texel is RGB (78,131,255), while the
nearby 200-DPI profile has no corresponding bright highlight (at 1.298pt it is
(38,89,221)). Finer subdivision is therefore not automatically closer to the
native low-resolution preview.

Browser checks compare interior lighting against nearby native colors and
measure the silhouette separately in both directions, with the existing 3D
1.25pt boundary tolerance. Outer coverage fringes and outline/contour material
transitions are excluded from color assertions. The outer boundary is measured
separately; inner material transitions were also visually reviewed. This does
not certify pixel-identical antialiasing or every inner material boundary.
The original XML is retained through no-edit export,
editing/reopening and exact undo checks.

## Validation

172 targeted unit cases pass, including the full coordinate range. Seven
distinct browser cases pass: the 23-page bevel workflow; existing 3D, outlined
3D, rotated lighting, backing-fill and shadow regressions; and the 11-page
combined-surface control. The latter checks interior color/compositing through
editing, undo and reopening; it is not a separate quantitative edge oracle.
Its larger raster workload uses explicit 60-second load/reopen waits instead of
the small-fixture helper's five-second default.

The reference application reopened the browser-edited bevel control: all 23 picture regions are
RGB-identical to the original native PDF. All three sources and their browser
exports pass the transitional schema checker. Build and license checks pass.
The construction brochure remains two editable pages with identical rendered
pixels and successful editing/undo/reopening. The signature gallery remains
read-only because its outer and inner picture extents differ; pagination also
remains unresolved. This feature does not complete that original template.
