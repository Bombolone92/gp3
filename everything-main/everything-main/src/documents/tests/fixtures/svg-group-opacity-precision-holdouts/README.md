# Float32 opacity boundary holdouts

Twenty-two original controls straddle lower/upper Float32 values at opacity byte
rounding boundaries, including decimal values immediately on either side of
0.10000000149011612 and 0.7000000476837158. Each has an opaque rectangle and a
separate `.503` fill-opacity strip. All native RGBA bytes must match exactly.

Generate with `python tools/svg_group_opacity_precision_fixture.py --holdouts`.
Confirm the owned `control.docx` with the reference-application opening helper, capture its first
inline picture read-only with `tools/capture_inline_picture_metafile.ps1`, then
record with `tools/record_svg_group_cubic.py --fixture svg-group-opacity-precision-holdouts`.
The latter takes the capture folder as its positional argument. The manifest
binds source, cases, capture metadata, both metafiles and every PNG by SHA-256.

The reference application generated the references. No corpus artwork, font programs or
third-party document engine is included. Generator dependencies are python-docx
(MIT), lxml (BSD) and the standard library. See the base family's README for arithmetic and limits.
