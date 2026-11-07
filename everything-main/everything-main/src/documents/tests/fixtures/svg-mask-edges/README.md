# Native curved SVG mask edges — fidelity work in progress

`tools/svg_mask_edges_fixture.py` independently authors six mask targets, repeated
as full, cropped, grouped and shape-fill pictures. The controls isolate integer
and fractional cubic paths, gray mask luminance, curved bounding-box mask
content, a masked rectangle and a rotated target. No corpus artwork is included.

The reference application exported the retained one-page PDF. The first inline picture's
owned native range was captured with `tools/capture-svg-group-raster.ps1`.
`tools/record_svg_masks.py <capture.emf> svg-mask-edges` extracts the nested SVG
metafile and six original PNGs, recording source/native/capture/PNG hashes,
dimensions, transforms and middle-column RGBA. Schema validation passes.

The original native PNGs establish separate target/mask sampling behavior.
The first target's curved edge has many coverage-alpha values. The fifth target
(an opaque rectangle with a white elliptical mask) has alpha values only 0,
254 and 255: 314 transparent, 86 near-opaque and 716 opaque pixels. The browser's
continuous mask-edge coverage therefore does not reproduce this native output.
The SVG masking model combines mask luminance and alpha; this native edge
conversion needs compatibility handling backed by these controls.

Diagnostic comparisons against the native PNGs tried intrinsic rendering,
8×4 and 8×8 browser sampling, half-sample translation, and the existing solid
group coverage path. None matches all six cases. In particular the fourth and
fifth controls still have large edge-alpha errors under supersampling. Do not
ship a global sampling change or treat the existing rectangular-mask interior
test as proof of edge fidelity. Mask-paint opacity versus geometric coverage
needs further isolation before implementing the native conversion rule.
