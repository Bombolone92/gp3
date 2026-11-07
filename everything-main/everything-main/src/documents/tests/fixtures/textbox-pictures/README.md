# Inline pictures inside retained text boxes

`tools/textbox_pictures_fixture.py` authors the original XML and three-color PNG.
It uses python-docx, lxml and Pillow; no user artwork or third-party document
engine is copied. The reference application exported the eight-page reference.
`tools/record_textbox_pictures.py` records PDF/source hashes and renders the PNGs
at 4x before BOX downsampling to 96dpi. All eight native/browser pairs were
visually inspected.

Cases cover identity, uniform/nonuniform group scaling, nested groups, rotated
shape text, center anchoring, frame clipping and a cropped/flipped inline picture.
Pictures retain physical inline dimensions under group scaling, just like the
surrounding text. The inherited text-frame clip applies to their ink. The browser
test compares the original saturated image colors in both directions within a
one-pixel neighborhood, through body insertion and export/reopen. Initial rendering also compares dark glyph presence, including overlapping
paragraph text, with edge antialiasing tolerance. Unit tests preserve retained scene
content, image relationships, unrelated package parts and exact undo.

ECMA-376 Part 1 §17.3.3.9 (`drawing`) and §20.4 describe inline drawings as run
content affecting line height. This extends that existing path to retained
`wps:txbx/w:txbxContent`. No new reference/spec divergence is observed by these
controls. Text box contents remain part of the atomic retained drawing, not
separately editable main-story positions. Floating pictures remain guarded. Reflected text groups have a separate native
matrix in `../reflected-textboxes`. These controls do not establish every nested drawing,
field-dependent picture, or rotated inline-picture/line-clipping combination.
