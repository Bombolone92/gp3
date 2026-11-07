# Shape flips native reference

Original XML from tools/canvas_shape_flips_fixture.py, based on our own curve
fixture package. Six cases share an asymmetric custom path extending outside
its frame, with no flip, horizontal, vertical, both, lexical booleans and both
axes under anisotropic nested group scaling. All contain text.

The exact source was opened in the reference application and exported without
saving. tools/shape_flips_reference.py records its hash, 48 colored ink
cross-sections and the PDF text objects' horizontal/vertical matrix axes.
Rows avoid the shallow near-horizontal upper edge, where subpixel coverage
changes disproportionately shift a horizontal threshold intersection.
Browser tests compare edges within 0.75pt, text orientation/physical scale,
text edits, export/reopen and exact ZIP-entry undo. Full images were inspected.
The fixture's default font differs between the reference application and the playground; these
checks establish geometry and orientation, not exact glyph rasterization.

Part 1 section 20.1.7.6 specifies reflection about a shape's bounding-box center.
Native reference text behavior: horizontal flips leave text upright; vertical
flips rotate text 180 degrees (including when both flip flags are true). This
fixture demonstrates that the reference application does not simply mirror the text with its path.
Group reflections and rotations remain unsupported.
