# Floating custom-picture crops

The original XML generator `tools/floating_picture_crop_fixture.py` derives its
package and original quadrant PNG from this project's picture-geometry control.
It does not use the application's serializer. The reference application exported the exact
fixture to the retained one-page PDF without saving changes to the DOCX.

Eight page-relative, no-wrap custom pictures cover unchanged geometry, positive
source crop, each reflection and both reflections, negative transparent crop
outsets, combined crop/duotone/50% opacity, and triangular clipping. The recorder
samples interior/exterior points at 288 DPI and binds source/PDF SHA-256 hashes.
Triangle diagonal boundary samples are excluded to avoid antialiasing differences;
opaque interiors compare exactly, and the translucent control allows three RGB
levels for PDF/canvas premultiplied quantization, as in picture-alpha controls.

The browser repeats comparisons after a body edit, undo, and reopening the export.
Unit checks retain scene transforms, all untouched OPC parts, and exact full undo.
Rotation and 3D custom geometry remain outside this independently verified
subset. Ordinary rectangular floating crops/reflections are covered separately
by the `positioned-picture-crop` reference control.
