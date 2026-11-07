# Ordinary picture-outline controls

`tools/picture_outline_fixture.py` authors `public/fixtures/picture-outlines.docx`
from this project's original custom-picture geometry fixture and quadrant PNG.
No corpus content or third-party artwork is included. The reference application opened the
source read-only and exported `native.pdf`. The source and PDF hashes are recorded
in `reference.json`; `tools/record_picture_outlines.py` records 3,749 native
samples and twelve outline bounds. Samples require a one-point neighborhood of
flat native color, consistent with the existing picture-geometry controls, to
avoid antialiasing and texture interpolation boundaries.

The twelve controls cover rectangles, triangles, reflection, a cubic contour,
a hole, an unfilled path, crop with dashes, a standalone picture, inset geometry,
separate stroke/fill paths, disjoint paths, and translucent overlapping textures.
All outlines use a 3 point opaque magenta pen; picture opacity does not affect
that pen. Most controls have two nonuniformly scaled ancestor groups.

The reference application places ordinary picture outlines outside the texture contour. The first
144 by 72 point texture occupies x=60..204 and y=90..162; the outline centerline
occupies x=58.5..205.5 and y=88.5..163.5. Its outer ink therefore extends a full
pen width beyond the texture. Triangle centerline vertices measured in the PDF
are (318.5,88.5), (470.35,88.5), (318.5,164.43). The hole offsets inward. These
measurements distinguish edge offsets from bounding-box expansion and from
ordinary centered shape outlines.

The browser test checks pixels and physical bounds before/after text editing,
undo and export/reopen. Original picture XML and untouched package parts must
survive. Opaque samples are exact; the overlapping half-opacity control retains
the established six-level PDF/canvas compositing tolerance.

`picture-sketch-outlines.docx` is generated with `--sketch` and is a separate
unresolved extension control. Its native reference PDF disproves using supplied custom paths
as a substitute for sketch regeneration. The strict importer continues to reject
that extension; it is not included in the ordinary-outline support claim.

Validation: the new outline browser test and 17 existing picture/shape browser
checks pass, including 3D and compound outlines. The targeted unit run passes
72 checks; its one failure is the existing paired-off capitalization test's
five-second deadline, also reproduced in an unchanged `f3ab059a` worktree.
No test timeout was changed. Source/export schema validation and the production
build/license check pass. The original Construction brochure also still opens
editable as two pages, matches the retained native page views, and passes
no-edit preservation, insertion, exact undo and export/reopen.
