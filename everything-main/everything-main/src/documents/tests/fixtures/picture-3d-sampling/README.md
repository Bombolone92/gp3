# Original 3D picture minification controls

`tools/picture_3d_sampling_fixture.py` authors six pictures in our original
MIT OPC envelope. The three 2048 x 2048 PNG textures are generated from integer
checker, diagonal and coarse checker formulas. Each is used in a 144 x 108pt
front rectangle and a 20pt-deep perspective-left ellipse. No corpus artwork,
commercial font program or third-party document engine is included.

The exact unchanged control was opened using the reference-application opening helper in
the reference application. `tools/capture_picture_3d_sampling.ps1` reads the existing
owned document's six page EMFs and records its source hash, Saved state and
612 x 792pt page dimensions. It neither saves the document nor closes the reference application.
`native.json` binds each compressed EMF and fixed RGB region to this source.

`tools/record_picture_3d_sampling.py` independently decodes each single lossless
GDI image and verifies the 5100 x 6600 logical page mapping. It rejects unsupported
transforms. The exact logical page is resized with Pillow Lanczos to four pixels
per point; the fixed region [140,175,200,210]pt stays inside the picture face.
`--record-rois` writes original native RGB references; its default mode recomputes
and verifies every byte, hash, mean and standard deviation. No native reference
is used to draw a viewer picture.

Before the correction, the nominally uniform native checker region develops
false bands: browser standard deviation 8.50 vs native zero. This is a verified
red regression using the original sampler. Half-size source filtering removes
the bands; four fine-pattern regions have native mean absolute RGB errors
1.00, 1.09, 1.12 and 1.82, against 5.90, 8.53, 25.92 and 28.63 before the fix.
The flat coarse control remains pixel-identical to the old renderer; the
extruded coarse error improves from 6.37 to 6.03. These controls retain the
existing preview density, geometry, materials and camera support.

Browser tests compare actual fixed native RGB fields, not only mean brightness.
They preserve coarse contrast and pixel identity, test crop/outsets, transparent
alpha and backing fills, then verify edit, unchanged package parts, exact undo
and fresh reopen. Node tests bind reference hashes and strict OPC round trips.
Native capture includes bitmap quantization and final Lanczos resampling; the
controls do not prove all projected boundary pixels match the reference application.

ECMA-376 Part 1 §§20.1.8.55-56 (`srcRect`/`stretch`), §20.1.5.5 (`camera`),
§20.1.5.12 (`sp3d`) and §20.1.10.47 (preset cameras) describe the retained source
and geometry. No mandated raster kernel or new reference/spec divergence is claimed.
The reference application's ordinary source minification provides independent behavior evidence.

No current original corpus picture triggers a whole half-size reduction, so this
fix does not complete a template. The original birthday card #10 remains partial.
A separate denser-preview experiment improved its photo error only about 1% and
was not adopted.
