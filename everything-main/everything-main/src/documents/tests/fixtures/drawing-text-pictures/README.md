# Pictures in drawing-text drafts

These three controls are independently assembled OOXML using the generator
`tools/drawing_text_pictures_fixture.py`. All artwork is original: an 8×8 red
square, encoded with Python's standard-library PNG chunks and handwritten SVG.
No corpus artwork, font programs or third-party document engine is included.

- `control.docx`: one standalone and two grouped WPS text frames, containing
  ordinary PNG and SVG pictures with PNG fallbacks between neighboring words.
- `structures.docx`: the same picture runs inside a persistent block content
  control and a drawing-local table cell.
- `header.docx`: a standalone frame in a header with relationships owned by
  that header; the grouped body frames remain independent.

Unit checks cover neighbor edits, source identity, duplicate rejection,
geometry serialization, deletion, repeated strict drafts, header ownership,
controls, tables, export/reopen and exact package-part undo. Browser checks use
actual context-menu drafts, keyboard image handles, Apply/Cancel and download;
red-pixel assertions verify pictures are painted, rather than just present in
XML. Resource lifecycle checks retain borrowed parent previews while closing
new draft font-refresh previews.

These are structural/editing controls, not a new native reference layout oracle.
Existing picture rendering and source-preserving serialization are reused.
