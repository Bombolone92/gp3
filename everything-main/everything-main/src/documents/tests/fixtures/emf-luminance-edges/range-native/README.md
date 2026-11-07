# Native range bitmap evidence

The base and independently authored doubled-frame controls were opened through
the reference document-opening helper. The reference application confirmed the exact original
paths and no unsaved changes. `Content.EnhMetaFileBits` was read without forced
repagination, PDF export, source changes, or closing the user's reference application instance.
`tools/capture-emf-range.ps1` contains the capture procedure. The corresponding
inputs come from `tools/emf_luminance_edges_fixture.py`, with `--variant base`
and `--variant expanded-frame`; no corpus artwork is used.

These are native range metafiles, **not screen captures**. Their reference device
is 5100x6600 pixels over 216x279 mm, approximately 600 dpi. Both contain four
compressed PNG effect images, in authored row order:

| Row | Native range PNG | PDF PNG |
| --- | --- | --- |
| 1 | 400x394 | 133x131 |
| 2 | 599x590 | 199x196 |
| 3 | 800x787 | 266x262 |
| 4 | 402x398 | 133x132 |

All eight bitmap drawing records use pixel source units and source rectangles
`[-0.5,-0.5,width,height]`, with destination points `[0,0]`, `[width,0]`,
`[0,height]`. These are coordinates from the native records, not instructions
to apply that offset to HTML canvas or a claim of screen pixel equivalence.
The bitmap dimensions in the compressed image's EMF+ header are undefined; the
reader obtains them from the actual PNG stream.

`tools/record_emf_range_bitmaps.py` reproduces both reference JSON files. It
checks source, capture, reference PDF and extracted PDF-image hashes; records
the original compressed PNG and decoded RGBA hashes; and bounds EMF comments
and EMF+ payloads separately. `tools/test_emf_range_bitmaps.py` verifies both
native datasets and rejects truncated captures, comments extending into the
next record, and inconsistent declared record counts.

A fresh capture through the reusable procedure reproduces all four original
PNG hashes, decoded RGBA hashes, sizes and draw records. Native object-table
indices may change between captures and are not a visual identity criterion.

The differing raster sizes establish that PDF image edges alone cannot prove
native display equivalence. The subsequent output-device correction uses the
physical frame and includes the final pixel at the raster's own resolution.
It retains the original source SVG viewport so crossing strokes survive until
the output canvas clips them. The additional `overflow.emf` capture comes from
the independently authored `emf-luminance-edges-overflow-frame` control, with the
same four raster sizes. Browser checks match all twelve native dark bounds,
within the recorded alpha/coverage tolerances; antialiasing is not byte-exact.
There is no complete-corpus promotion from this correction.

Structure references: [MS-EMFPLUS bitmap](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/112a5e2c-6bb3-4daf-8ee3-0f3d3984410f),
[compressed image](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/9c00912b-adfa-469e-8baa-82d9d3d8d6ae),
and [image points](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/9bad3867-71b0-46fb-9b90-f7d8fb37ff76).
