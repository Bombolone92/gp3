# Texture placement controls

Seven independently authored pages use a 512 x 512 RGB bitmap whose red and green
channels encode repeated horizontal and vertical ramps; blue is constant. The
fixture contains no corpus artwork or font files. Source, generator and synthetic
assets are covered by this repository's MIT license.

`control.docx` contains equal 178pt inner/outer frames, uniformly larger and
smaller inner frames (178.3/177.7pt), opposed 178.3 x 177.7pt extents, and an
orthographic front control. `plain.docx` removes 3D effects from the front control;
`left.docx` reverses the first control's camera. Captions use ordinary Arial CSS
font selection. Generate into a fresh folder with
`python tools/picture_3d_uv_mapping_fixture.py --output <folder>`.
All package parts of a fresh generation match the captured source parts.

Native reference captures retain seven unchanged source-bound 612 x 792pt
pages. `native/*/capture.json` records Saved state, source hashes and original
EMF lengths/hashes. Gzip files retain the native EMF+ dual streams. After opening
an exact owned copy through the reference-application helper, `capture_picture_3d_uv_mapping.ps1`
reads that already-open copy with `-Source`, `-OutputRoot` and `-Kind` (projected,
plain or left). It does not save, close the reference application, change its view or access fonts.

`raster_picture_3d_uv_mapping.ps1 -CaptureRoot <folder> -OutputRoot <fresh folder>
-PixelMode Default` replays the stream at four pixels per point using the explicit
5100 x 6600 logical source rectangle. Repeat with `Half` in another fresh folder.
Both policies are retained separately; neither is selected by lower comparison
error. Each policy was replayed independently and all 14 PNGs were reproduced
byte for byte. `record_picture_3d_uv_mapping.py` verifies hashes, source state,
bounded EMF/EMF+ records, declared record counts, 600 DPI headers and the logical
page mapping. `--record` writes the reference; its default mode verifies it.

The fixed region [600,780,900,1060] pixels avoids captions and outer silhouettes.
The reference application paints the first three controls identically under both policies. The
opposed-extents control differs. The viewer independently agrees with both
relationships. Browser regressions compare actual region pixels and preserve
editing, unchanged package parts, exact undo and a freshly opened edited export.

These controls do **not** establish pixel-perfect native texture fidelity.
Default/Half mean RGB errors are 2.915/2.180 for the right camera, 1.874/1.635 for
the left camera, 2.341/3.012 for the front control and 3.126/1.212 for plain 2D.
The opposite effects on front and plain controls reject choosing a mode per
document merely to lower error. Native plain draw coordinates also quantize
100..278pt and 140..318pt edges to 600 DPI integer coordinates (833..2317 and
1167..2650). This is evidence of output-device rounding, not a requirement to
hardcode that resolution in the viewer. No renderer offset or acceptance-bound
change is introduced. Original birthday card #10 remains partial.

Relevant OOXML structures: ECMA-376 Part 1 §20.4.2.7 (`wp:extent`), §20.1.7.3
(`a:ext`), §20.1.7.6 (`a:xfrm`), and §20.1.5 (`scene3d`, `camera`, `sp3d`). The
existing uniform contain-fit rule remains supported by native evidence; the
texture residual is a separate open issue. GDI+ pixel-center semantics are
documented in the [PixelOffsetMode reference](https://learn.microsoft.com/en-us/windows/win32/api/gdiplusenums/ne-gdiplusenums-pixeloffsetmode).
