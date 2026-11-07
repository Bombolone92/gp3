# Dense native 3D texture controls

`tools/picture_3d_texture_fixture.py` independently authors the DrawingML and
two 128×128 PNG textures, using only our original `public/fixtures/picture-3d.docx`
OPC envelope. No corpus artwork, renderer export, font binary or third-party
document engine is used. Gray is `(128,128,128)`; gradient is
`(64+x,64+y,128)`. Each texture appears in four scenes: front rectangle,
perspective-right rectangle, perspective-right ellipse with extrusion and
contour, and perspective-left ellipse with extrusion and outline.

The exact control was opened in the reference application through the
reference-application opening helper, then exported without saving. `native.pdf` has eight pages;
its labels and source/PDF hashes are checked independently. The automation API's immediate
page-statistics call reported two pages, which is not the completed PDF's page
count. `tools/record_picture_3d_textures.py` checks the PDF pages and records
49 interior samples per scene, using PDFium at four pixels per point. It also
records each native image's filter. No PDF raster or extracted native image is
used as the viewer's texture.

The four losslessly encoded gray scenes agree within two RGB levels at all
196 sample points. Native gradient images use `/DCTDecode` (JPEG), and the
maximum errors against the viewer are 6, 5, 5 and 4 RGB levels respectively.
The unchanged comparison bound is four. The first three gradient comparisons
are explicit expected failures, not fidelity passes or proven renderer defects.
JPEG export is a comparison confounder; its presence alone does not prove it
causes the entire difference. A native reference without that confounder or
an independent color-transform measurement is needed before changing lighting.

The browser suite reports six ordinary passes (five fields plus the editing
workflow) and three expected failures. The workflow checks all eight pages,
no-edit ZIP identity, retained picture parts through a text edit, exact undo,
and edited export/reopen. Two unit tests bind the references and check strict
import and exact package round-trip. Source and browser exports pass schema
validation; that does not establish complete rendering agreement with the native reference.

Relevant ECMA-376 Part 1 clauses are §20.1.5.5 (`camera`), §20.1.5.12
(`sp3d`), §20.1.10.47 (preset camera types) and §20.1.4.1.26 (`scene3d`),
as in the existing `picture-3d` controls. This adds measurements within the
existing supported cameras, lighting and materials, not new feature support.
The original Father's Day card (#10) remains partial.

A subsequent [full-color native page comparison](device/README.md) removes the
PDF export path from the comparison. All eight fields now agree within two RGB
levels at the same 49 fixed coordinates. The existing JPEG-PDF diagnostic and
its three expected failures remain unchanged; they do not establish a shader
regression. The native GDI fallback also reduces channel precision on six pages;
EMF+ playback supplies the stronger independent color reference. This does not
complete original card #10 or justify a lighting formula change.
