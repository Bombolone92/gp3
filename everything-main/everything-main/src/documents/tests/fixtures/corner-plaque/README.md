# DrawingML plaque controls

Original controls generated with `python tools/corner_preset_fixture.py plaque`
from the project's original shape-defaults OPC package. Eight scenes cover
standard defaults, zero/intermediate/near-maximum corner depth, negative and
excessive clamps, a conflicting portrait inner transform, and rotation/flips. Three contain Arial text
for the standard text rectangle. No external artwork or fonts are bundled.

The reference application exported native.pdf. Run
`python tools/corner_preset_reference.py plaque` to record native solid-color
ink samples and text origins, bound to the DOCX/PDF hashes. The recorder holds
the PDF bitmap alive until the image pixels have been copied. Browser tests
compare native ink, text origins, editable export/reopen and exact undo.

The reference is ECMA-376 Part 1 sections 20.1.9.18, 20.1.9.11, 20.1.10.56 and
its supplied presetShapeDefinitions.xml. The implementation is original.

The sixth scene intentionally declares an 80x110pt inner transform inside a
200x90pt WordprocessingML frame. The reference application evaluates the preset at 200x90pt, without
stretching corners evaluated in the inner aspect ratio. This control catches
that independent frame-resolution issue; it is not a portrait output page.
