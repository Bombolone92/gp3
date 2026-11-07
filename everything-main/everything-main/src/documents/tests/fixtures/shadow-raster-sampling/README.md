# Native shadow raster sampling and color references

Twenty original OPC/XML controls are generated deterministically by
`tools/shadow_raster_sampling_fixture.py`, using the existing authored
picture-shadow package shell and a new opaque black PNG. No corpus artwork,
third-party renderer or font binary is included.

The first twelve controls vary rectangle dimensions, blur and fractional
translation. Eight zero-blur controls separate RGB/opacity conversion from
blur. `tools/export-reference.ps1` opened this exact source read-only in
the reference application and exported twenty pages. `tools/record_shadow_raster_sampling.py`
checks every PDF label and records image dimensions, transforms, central alpha
profiles, alpha hashes and raw premultiplied center pixels. The PDF shadow
images have a black `/Matte`; these RGB bytes are not straight-alpha colors.

The tempting grid formula `round((extent + 2*blur) / (0.36 + 0.12*blur))`
predicts eleven of the twelve blurred dimensions but fails the 144pt/18pt
holdout: 71 predicted, 72 observed. Do not ship it as an established native rule.
Moving the fractional rectangle 0.3pt moves its PDF image 0.36pt on each axis
without changing its alpha bitmap. Sampling dimensions and placement both need
investigation; neither is specified exactly by OOXML outerShdw (§20.1.8.45).

## PDF and metafile colors are distinct references

`tools/capture-shadow-color-metafiles.ps1` captures native page ranges 13–16 with
Range.EnhMetaFileBits, then renders them on white with Windows GDI+. Coverage now
includes all eight zero-blur controls, pages 13–20. The recorder
retains the raw EMFs, lossless PNGs, hashes and a stable interior sample (also
checked over a 21px neighborhood). These are native metafile references, **not
direct reference-application screen captures**. PDF page samples use PDFium at the corresponding
physical shadow center (324pt,136pt).

| Control | Raw PDF premultiplied RGBA | PDF composite | GDI+ composite | Browser |
| --- | --- | --- | --- | --- |
| Purple, opaque | 128,64,192,255 | 128,64,192 | 128,64,192 | 128,64,192 |
| Purple, 60% | 76,37,114,153 | 177,138,216 | 179,140,217 | 179,140,217 |
| White, opaque | 255,255,255,255 | 255,255,255 | 255,255,255 | 255,255,255 |
| White, 60% | 152,152,152,153 | 253,253,253 | 254,254,254 | 255,255,255 |

A renderer correction based solely on the darker PDF bytes would regress the
purple metafile comparison. The strict white metafile comparison is retained
as an expected failure. It must not be removed by weakening its assertion.

The recorder also extracts each EMF+ PNG image object's center RGBA directly,
before Windows playback. At 60% opacity the native shadow bitmap contains
purple `(128,63,191,153)`, white `(254,254,254,153)`, dark `(1,1,3,153)` and
blue `(63,128,191,153)`. Their opaque counterparts retain the authored RGB.
Thus the white loss is already present in the reference application's generated bitmap; final
compositing or PDF rendering alone cannot explain it. This does not establish
a general conversion formula across other opacities, source alpha or blur.
Seven native composite controls pass; the white comparison remains strict and
explicitly failing. No production adjustment is inferred from one opacity.

Separately, browser-only Gaussian probes compared the existing kernel with
infinite-Gaussian normalization, integrated per-texel weights, and both changes.
All four variants still pass the twelve earlier opaque-square profile controls;
all four still fail the textured wide shadow at nine samples with error five
against an unchanged allowance of four. This rejects those kernel changes as
a solution. Production code is unchanged. The existing textured-shadow expected
failure and corpus document #128's partial status remain.
