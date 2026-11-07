# Nested mask composition and transparent paint

These six original cases extend svg-mask-composition with isolated nested
groups, a chain of single-child groups, fractional rectangle edges and two
zero-opacity paints. Generate with `tools/svg_mask_nested_fixture.py`; add
`--intermediate` to produce the identity-filter companion. Capture each first
inline range with `tools/capture-svg-group-raster.ps1` and record it with
`tools/record_svg_masks.py CAPTURE.emf FIXTURE_NAME`. Source,
native metafile and PNG hashes are recorded in both folders.

The final mask calculation (luminance rounded to a byte, then alpha applied)
matches every native pixel against its paired native intermediate. The
transparent paint cases retain only the first rectangle's 15-by-38 raster:
The reference application elides both fill-opacity zero and object-opacity zero. A direct GDI+
transparent brush call may requantize the destination; that API quirk is not
native SVG behavior and is not included in the SVG prototype.

The numerical rectangle prototype now matches all 22,800 mask alpha pixels
across 84 controls, including this set. It uses byte brush alpha, premultiplied
channel coverage, rounded source-over arithmetic with straight-ARGB storage,
and truncated 16-bit reciprocal conversion back to straight RGB. Group opacity
is applied after children. Later ordinary-group controls show that the earlier
single-child opacity-folding model was an accidental fit: group image opacity
is rounded to a byte and each group remains isolated. The corrected diagnostic
still matches all 84 mask controls. See `svg-group-composition` and its chain
companion. Simple round-to-even at every group is also insufficient.

Reproduce with `node tools/probe-svg-mask-compositor.mjs PLAYGROUND_URL`.
The tool appends a diagnostic fragment to the group module only in its owned
browser session. It does not activate or modify the application renderer.
Curves, images, gradients, general mask coordinate systems and broader editing
integration remain unimplemented in the prototype. Passing these rectangular
controls does not establish complete SVG mask fidelity or complete corpus document #288.

Seven reference tests, both new source packages' 20 XML schema checks, and the
exact 84-control browser diagnostic pass. The separate Windows GDI+ arithmetic
sweep matches all 256 recorded color/alpha inputs; it is supporting API evidence,
not a substitute for the original native controls.
