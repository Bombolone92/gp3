# Coincident open-path round caps

`tools/point_outlines_fixture.py` builds 16 original controls on two pages from
the repository's original shape-defaults OPC fixture. Cases cover coincident
lines, quadratics and cubics with flat/round/square caps; a move-only path; a
closed point; a cubic returning to its origin with distinct controls; three
pen widths; and an off-center point. No corpus artwork is included.

The reference application exported `native.pdf` from the exact source. The manifest binds
source, PDF and case hashes. The reference application's on-screen 100% view was also inspected in
the independently opened `collapsed-stroke-native-check.docx` copy: the round
line and cubic points are visible. This matters because Poppler paints round
coincident Beziers from this PDF while PDFium omits them. PDF output alone does
not settle those rasterizer differences. Native PDF pens retain the declared
width, with the independently established 0.14pt minimum for zero-width pens.

The production correction paints the round cap of a wholly coincident, open,
solid path at its transformed location, with the existing physical pen width.
It does not collapse returning curves with distinct controls, paint move-only
or closed paths, or change dashed/compound/marked strokes. Multiple isolated
point subpaths mixed with nondegenerate segments are outside this correction.
Square-cap degeneracies remain unverified: PDF renderers disagree, and no
square/flat cap behavior is changed here.

The browser regression checks the seven round-point cases, their positions,
excluded path types, editable import, unchanged package parts, insertion,
unrelated-part preservation, exact undo and edited reopening. Its native
manifest is provenance, not a claim of pixel-identical rasterization.
