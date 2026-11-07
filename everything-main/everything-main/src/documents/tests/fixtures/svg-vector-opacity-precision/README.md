# Pending vector SVG opacity precision

Original authored controls extend the existing paint-opacity rectangles into
opaque groups, then add all 256 byte fractions, twelve near-one/CSS boundaries,
and 24 equivalent rectangle/path pairs in three colors. There are 324 cases and
380 visible-or-explicitly-zero paints. No corpus paths, artwork or font programs
are included. Native references come from read-only reference-application picture-range
captures. Hashes bind the exact source, cases, metadata, capture and nested EMF.
The nested stream contains paths and a clipping region, with no font/image objects.

The reference application's native inline ARGB records have alpha 50,101,152,203 for .2,.4,.6,.8.
The lower adjacent Float32 followed by byte truncation explains every byte-fraction
control; fractions 1/255 through 254/255 produce bytes one lower than their nominal
numerator. The explicit zero paint is omitted; 255/255 remains 255. Equivalent
rectangle/path pairs have identical native colors. Near-one declarations produce
254; out-of-range declarations clamp to 255. The reference application ignores the tested CSS exponent,
percentage and calc declarations and keeps the earlier .8 presentation value (203).

The current vector renderer still fails these alpha controls. An alpha-only
candidate matched the initial 332 browser alpha samples and existing ordinary
opacity/group regressions, but worsened corpus artwork. The rejected patch is
retained for investigation only; it is not loaded by production. Alpha and
overlap/backdrop color composition must be addressed together before correction.

The browser expected failure is declared only after source preservation,
temporary-host cleanup, editing, export/reopen and exact undo checks complete.
The unit expected failure exposes the current helper's byte-fraction mismatch;
native capture integrity and paired-shape checks are ordinary passing tests.

Regenerate with `python tools/svg_vector_opacity_fixture.py --output-dir <scratch>`.
Confirm the owned scratch document with the reference-application opening helper, then use
`tools/capture-svg-opacity-metafile.ps1` with its exact source hash. Record with
`python tools/record_svg_vector_opacity.py <capture-directory> <output-directory>`.
Package parts and case bytes reproduce exactly; ZIP container timestamps may differ.

These captures establish native compatibility, not a normative specification of its
Float32 intermediates or full SVG compositing. Public PDFs and font programs were
not created. The controls do not promote any corpus document.

An identity paint-surface follow-up
matches the native flat-color and premultiplied controls but remains rejected
after guarded timing and original-color checks. The production expected failures
remain; earlier comparisons with unnormalized Windows route keys are discarded.
