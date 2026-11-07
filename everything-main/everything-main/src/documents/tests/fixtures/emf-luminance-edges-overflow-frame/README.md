# EMF strokes crossing the physical frame

`tools/emf_luminance_edges_fixture.py --variant overflow-frame` authors this
control. It keeps the original rectangular outline, chevron, drawing bounds,
reference device, colors, DrawingML effects and four display sizes. Only the
physical EMF frame changes to `[0,0,3281,3228]` hundredths of a millimeter.
The outer stroke now crosses that frame. No corpus artwork is used.

The reference application opened the exact original path, confirmed no unsaved changes,
and supplied `Content.EnhMetaFileBits`; its source hash stayed unchanged.
The original also exported to the one-page `native.pdf` without source mutation.
`tools/record_emf_luminance_edges.py --variant overflow-frame` records PDF
placement and extracted image hashes. The native range capture and reference
are `emf-luminance-edges/range-native/overflow.emf` and
`overflow-reference.json`, read by `tools/record_emf_range_bitmaps.py`.

The control distinguishes scaling the physical frame from prematurely clipping
strokes to it. The output raster must retain crossing strokes until its own
canvas clips them, including ink covering the last output pixel. The browser
regression checks native dark bounds, alpha error and coverage at all four
native sizes, plus editing, package/media preservation, exact undo and reopen.

ECMA-376 Part 1 §20.1.8.42 defines the luminance operation, but does not prescribe
metafile rasterization. This is measured reference behavior, rather
than a claimed contradiction of an OOXML pixel sampling requirement.
