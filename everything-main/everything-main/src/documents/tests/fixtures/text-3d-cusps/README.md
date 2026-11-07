# Original acute-curve outline controls

Eight pages pair regular and synthetic-bold versions of four original shapes:
three short quadratic-to-line joins with -1/0/+1 coordinate perturbations, and
a polygonal companion. A rectangular outer contour surrounds an acute hole.
All outlines are authored in `tools/text_3d_cusp_fixture.py`; no installed font
outline or corpus artwork was copied. The temporary test font uses the existing
Source Sans Pro OFL-1.1 header generator under a new family name. No generated
font binary is retained or distributed.

Reproduce while the local viewer is running:

```
python tools/text_3d_cusp_fixture.py --output SCRATCH --units 2048 --tight --url http://127.0.0.1:5173/playground.html
python tools/compare_text_3d_cusp_controls.py SCRATCH
```

The generator registers its font temporarily, exports the exact source read-only
from the reference application, captures Canvas at DPR 3, unregisters the font in `finally`,
and deletes the temporary files. Opening this DOCX without running its generator
uses a fallback font and cannot reproduce the geometry. The recorder used the reference application. `reference.json` binds source, cases, outlines and native PDF hashes.

Flat material preserves the glyph-outline pipeline while excluding bevel
shading. At c0468d2c, every pixel in all eight red-ink masks is within one raster
pixel of the other mask, using the existing bidirectional Chebyshev metric at
four pixels per point. No alignment, excluded areas or tolerance changes are
used. The images were inspected. These controls do **not** reproduce the known
Franklin Gothic Book synthetic-bold 4 discrepancy, whose old/current captures
remain identical. A general acute-cusp change is not justified by this result.

An earlier 2048-unit capture had invalid Windows ascent/descent inherited from
the smaller-scale metadata. The reference application clipped the top of those shapes. Those captures
were discarded; only the corrected full-outline reference is included here.
The generator now opts into matching hhea/OS/2 ascent/descent values. Its default
GDI-only output remains byte-identical, so existing references are unaffected.

Source document/styles/settings pass standard MCE schemas; this is not validation
of w14 text-effect appearance. CT_Props3D describes the effect but does not specify
the font rasterizer's synthetic-bold outline algorithm. No new normative
reference/spec divergence or completed corpus template is claimed.
