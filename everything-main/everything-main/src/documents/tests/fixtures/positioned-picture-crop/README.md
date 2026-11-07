# Rectangular floating-picture crops and reflections

The original XML generator `tools/positioned_picture_crop_fixture.py` uses the
project's original quadrant artwork and custom-picture control as package
scaffolding, replacing custom geometry with ordinary rectangles. It does not
use the application's serializer or any private template artwork.

Eight no-wrap anchors alternate in front of/behind document text. They cover
natural pixels, positive source crop, horizontal/vertical/both reflections,
negative transparent outsets, and crop combined with duotone and 50% opacity.
The reference application exported the original DOCX without saving it. The recorder binds
source/PDF hashes and samples 160 points within the known picture frames. Opaque
interiors compare exactly; the translucent control allows three RGB levels for
PDF/canvas quantization. Both renderers must retain the same uncropped frame.

ECMA-376 Part 1 §§20.1.8.55–56 (printed p2881) define source-rectangle inset/
outset and stretch; §20.1.7.6 (printed p2851) defines center reflections. The
observed native behavior agrees with those clauses. No reference/spec divergence or
document-specific correction is needed.

The ordinary floating painter now applies retained crop and reflection metadata
before painting. It clips the mapped viewport and uses the existing decoded-image
painter, so vector/special decoded image objects do not get passed directly to
Canvas `drawImage`. Opacity, stacking, cell clipping and page-story context remain
in the existing path. Crop and reflection leave placement, wrap bounds, selection
and hit-test frames unchanged. Rotation remains rejected by the separate existing
floating-image validation; this change does not relax crop validation.

Browser checks repeat the native reference pixel comparison after text edits, undo and
reopening, and compare no-edit/undo package bytes and unrelated edited parts.
Unit checks edit an actual floating picture's crop/reflections, reopen the file,
verify frame/hit-test geometry and exact undo, and retain malformed-crop and
unsupported-rotation rejection.

Validation: 58 unit checks across six files and 13 browser cases pass, including
existing inline crops, custom-picture crops, page anchors and alpha effects.
Additional browser variants compare the same native crop/reflection samples under
square and top-and-bottom wrapping. Source/export schema validation passes 48
XML checks; production build and license gate pass. Full native/browser control
pages were visually compared.

The existing twelve-invalid-file aggregate test exceeded its five-second limit
with both unchanged and modified importers. Each unchanged rejection assertion
now runs as a separate case; no timeout or assertion was weakened.
