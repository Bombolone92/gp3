# Native donut geometry controls

`tools/donut_fixture.py` authors eight DrawingML donut shapes in the project's
original shape-defaults OPC skeleton. No corpus document or third-party artwork
is included. Cases cover the default adjustment, zero, maximum, negative and
above-maximum adjustments, narrow ellipses, flips and quarter-turn rotation.

The reference application exported `control.docx` to `native.pdf` using
`tools/export-reference.ps1`. `tools/record_donuts.py` records a 96-DPI PNG
from that independent PDF (4x rendering, BOX downsampling) and source/PDF/image
hashes. The whole native page was visually inspected before browser comparison.
The browser test compares both native-to-browser and browser-to-native pixels,
then checks editing, package preservation, exact undo and reopening.

Reference: ECMA-376 Part 1, 20.1.9.18 (`prstGeom`), 20.1.10.56
(`ST_ShapeType`), and the accompanying `presetShapeDefinitions.xml` donut entry.
The default adjustment is 25000; it is pinned to 0–50000 and scaled by the
shorter side. Outer and inner ellipses have opposite winding. At maximum
thickness an elliptical inner contour degenerates to a line, which the reference application still
outlines. At zero thickness the fill cancels and the outline remains. The text
rectangle comes from the outer ellipse's 45-degree points, independently of
thickness. No reference/spec divergence was observed in these controls.
