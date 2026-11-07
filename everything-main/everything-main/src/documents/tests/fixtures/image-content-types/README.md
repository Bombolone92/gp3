# PNG/JPEG payload and media declaration controls

Schema correction: the generator now supplies required w:zoom/@w:percent.
Fresh sources/exports pass schema checks. Regenerated native references are
pixel-identical to the earlier versions; source/PDF hashes were refreshed.

Generated independently with python-docx and Pillow by
`tools/image_content_type_fixture.py`. Both pictures are original blue/orange
rectangles. No corpus artwork is included.

`correct.docx` has correctly named and declared PNG/JPEG parts. The two
`*-payload-*-name.docx` controls rename one media part and its relationship
target, retaining the normal declaration for that extension. The reference application
opens both without repair and renders one page identical to the correct
control (PDFium 2x pixel comparison). Native PDFs and hashes are retained in
`native.json`.

`mismatched.docx`, `jpeg-as-png.docx`, and `png-as-jpeg.docx` change package
default declarations rather than part names. These are rejection controls;
the first two were explicitly rejected as corrupted by the reference application. No native result
is claimed for the third. They remain rejected by the editor.

ECMA-376 Part 2 (2021), 6.2.3 requires a MIME media type identifying each part's
content. The renamed payloads do not correctly identify their encoded format.
The reference application's acceptance is recovery behavior for a nonconforming package, not a
different normative interpretation. The importer uses validated PNG/JPEG bytes
when the declaration matches the part extension. It preserves original bytes,
names, relationships and declarations on save; it does not claim to repair the
package. Missing declarations and vector/raster mismatches remain guarded.

The browser regression compares complete canvas pixels across all three accepted
controls and verifies no-edit preservation, insertion, unrelated parts, exact
undo and editable reopening. Unit tests cover accepted and rejected controls;
existing image/SVG tests cover unsafe formats and relationships. XML schema
validation alone cannot detect an image payload/declaration mismatch.
