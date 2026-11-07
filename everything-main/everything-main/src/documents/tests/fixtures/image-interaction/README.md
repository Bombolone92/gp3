# Image interaction control

`control.docx` is independently authored OOXML with original PNG artwork, generated
by `tools/image_interaction_fixture.py` using Python's standard library. It does
not use this application's DOCX writer or another document engine.

It contains ordinary editable text overlapping a behind-text picture, another
floating picture in the same layer, and an inline picture with a later drop
destination. Browser checks exercise actual pointer/keyboard input, right-click
selection and ordering, resizing, floating and inline movement, Escape
cancellation, export and byte-exact package-part restoration after undo.

The external teacher-card check is optional through `DOCX_EDIT_REVIEW_SOURCE`.
That user-provided source is not redistributed here. Its first-click title
selection is a content-control placeholder in the reference application, not an image selection.

The print checks generate real Chromium PDFs, including portrait/landscape
sections and the external teacher card. They mock the native print dialog only;
printer drivers and other browsers are outside these checks. Printing uses
192-DPI raster page snapshots, so resulting PDFs do not have searchable text.
