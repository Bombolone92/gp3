# Saved invisible outlines

`tools/canvas_hidden_line_fixture.py` authors original OPC/XML controls using
the minimal package scaffold from `inline-object-baseline.docx`. The colored
rectangle paths and two-color PNG are original. No corpus content is included.

The reference application exported `native.pdf`; `native.json` retains source/PDF
hashes and PDFium object bounds. Eight controls pair absent/present
`a14:hiddenLine` on shapes and pictures, with either no visible outline or a
separate blue outline. The saved red dashed outline never appears and does not
change object placement or the visible outline. Colored objects avoid an
inconsistent solid-black rendering observed during reference preparation.

The first six controls isolate saved-outline rendering/editing. The last two
also contain visible raster-picture outlines, now supported by the picture
outline implementation. The full-source unit check verifies that both active
picture outlines remain present and saved hidden outlines do not alter scenes.
The focused tests remove only those trailing controls in memory, retaining the
first six the reference application positions and independent source XML.
Browser assertions compare their positions and dimensions to the reference application within 0.15pt.
Unit/browser checks cover saved metadata, surrounding text/image edits, reopen,
unchanged unrelated parts, and byte-exact undo.

MS-ODRAWXML §2.3.1.6 defines `hiddenLine` as saved `a:CT_LineProperties` for an
invisible outline, ignored when an outline is visible. ECMA-376 Part 1 Annex A.4.1
defines that type. The importer checks the extension identity, cardinality,
container attributes and ordered property groups. Inactive fill/dash/join/end
subtrees remain opaque and preserved; active outline rendering limitations do
not apply to them. The independent schema check validates the complete saved
subtree against the published, hash-pinned a14 declaration and ECMA's original type.
The [published a14 schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/869af0ef-665b-4f28-a596-0917474ede26)
is cached only in temporary test storage.
No reference/spec divergence was found and no runtime dependency was added.
