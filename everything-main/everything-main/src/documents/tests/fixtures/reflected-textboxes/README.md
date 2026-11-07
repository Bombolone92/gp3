# Reflected text boxes

Original controls: `tools/textbox_pictures_fixture.py --reflections`. No user
artwork or third-party engine is copied. The reference application exported
`native.pdf`; `tools/record_textbox_pictures.py --reflections` records hashes and
renders twelve pages at 4x before BOX downsampling to 96 dpi.

Cases: H, V, H+V; each with a rotated child; H/H, H/V, V/H nested groups;
nonuniform H and V groups; H with a vertically flipped child. Each frame contains
ordinary text and an original three-color inline image. Native evidence covers
readable text orientation, physical dimensions, frame relocation and inline
drawing ink over overlapping body text.

Browser checks compare original picture colors and dark glyph presence in both
directions within one pixel. Picture comparisons continue through body insertion
and editable export/reopen. Body glyph comparison is initial-only because editing
changes that text. No-edit/undo exact packages and unrelated parts are checked.
Unit tests compare retained scenes through editing and exports.

See docs/conformance.md, Reflected text boxes and inline drawing paint order,
for the §20.1.7.5 compatibility specialization and remaining guards. This matrix
does not establish every overlapping-drawing or upright-text case.
