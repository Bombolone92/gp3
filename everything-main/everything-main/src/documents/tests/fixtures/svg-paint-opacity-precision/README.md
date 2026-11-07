# Native SVG paint-opacity precision

Original rectangle artwork authored by `tools/svg_paint_opacity_precision_fixture.py`.
The DOCX package comes from the existing original SVG fixture generator using
python-docx (MIT) and lxml (BSD); no corpus artwork or font programs are included.

Thirty-two isolated `.7` groups contain colored full rectangles and white
fractional-edge rectangles. Controls cover object opacity, fill opacity, inline
styles, adjacent Float32 boundaries, multiplied opacity, stylesheet specificity,
duplicate declarations, inherited fill opacity and explicit inherit.

The reference application's read-only inline-range metafile capture provides embedded native
RGBA layers. `capture.json` binds source and capture hashes and confirms no save.
After opening and confirming an owned scratch copy in the reference application,
`tools/capture-svg-opacity-metafile.ps1 -Source <scratch.docx> -OutputRoot
<capture-directory> -ExpectedSha256 <source-hash>` captures the first inline
picture. It closes only the exact scratch document and quits the reference application only when
one newly created process identifies its independent instance.
`tools/record_svg_group_cubic.py --fixture svg-paint-opacity-precision` extracts
the native layers from an already confirmed capture directory. No screenshot
threshold or page-level reference is used as a substitute for layer comparison.

The browser test checks exact decoded RGBA, origins and dimensions, temporary
host cleanup, source SVG preservation, editing/export/reopen and byte-exact undo.
PNG straight RGB can differ after browser premultiplication; both native and
viewer images are decoded through the same canvas path for that comparison.
Intrinsic alpha bytes are independently compared without color conversion.
