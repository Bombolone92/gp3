# Nested picture rotation

`tools/group_picture_rotation_fixture.py` authors the XML from our original
group-picture-flips package and quadrant PNG. The reference application exported the
eight-page PDF without saving the source. The reference records source/PDF
SHA-256 hashes, stable color samples and visible bounds measured from PDFium
at four pixels per point. The recorder never reads application layout output.

Sixteen pictures cover zero, arbitrary, negative and quarter-turn angles,
45-degree boundary cases, all four scale-axis interval endpoints, reflections,
source crop with transparent outset, a custom triangle and a reverse-winding
custom rectangle. Every picture has two nonuniformly scaled ancestor groups
and nonzero child-coordinate origins. The unrotated frames are 144 by 72pt,
centered at (306,210) and (306,540) on each page.

The reference application resizes the frame before rotating about its transformed center. It
exchanges the ancestor scale axes for angles in [45,135) and [225,315) degrees,
confirming the existing rotated-line compatibility divergence for pictures.
Flips/crop/custom clipping rotate with the child. Ink may extend beyond the
ancestor's nominal frame and must not be clipped by bitmap allocation.

The browser compares exact stable colors and visible bounds within 1pt, then
repeats after body editing, exact-package undo and reopening. Original picture
XML stays unchanged. Unsupported group rotations, rotating shape text, picture
3D and nonrotating picture fills are outside this feature's scope.
