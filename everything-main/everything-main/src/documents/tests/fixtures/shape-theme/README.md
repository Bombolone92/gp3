Source: `tools/canvas_shape_theme_fixture.py`, independently authored OPC/XML.
The six anchored rectangles exercise theme line/fill matrices, placeholder
colors, a direct width overriding an inherited outline, explicit noFill,
linear-RGB shade/tint, and both orders of HSL lumMod/lumOff.

The reference application opened the exact public fixture. PDF and FlatOPC were exported
without saving changes; `manifest.json` records source and capture hashes.
`samples.json` records PDFium RGB samples at four pixels per point, using
page coordinates in points. Interior fill/outline samples and white space
away from antialiased stroke boundaries are compared in browser tests.

The reversed luminance sequence is #194D7F in the reference application's PDF. The generic
linear-RGB quantization correction now matches that value; the old #194D80
unit expectation predated that correction. Unit expectations use the retained
native samples and verify source/reference hashes. Browser comparisons require
exact RGB at all 24 interior/white-space samples. This does not establish identical
antialiasing: rasterized canvas stroke boundaries differ from vector PDF
edges. Numeric outline widths are separately checked against the PDF's
4pt inherited and 6pt directly overridden stroke widths.

The source and all retained drawing/theme parts survive body editing, export,
reopening and exact undo. Unsupported effects, gradients and other color
transforms remain guarded; this is not full theme-format conformance.
