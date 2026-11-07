# Equivalent split cubic controls

`tools/svg_cubic_step_fixture.py --split` authors the same eight closed shapes
as `svg-cubic-step-changes`, replacing each cubic with its two exact de Casteljau
halves at t=1/2. All split control coordinates are already on the 1/16 lattice;
native input quantization changes none. The two source DOCX packages differ only
in `word/media/vector.svg`. Original artwork only; no corpus data or font program.

`tools/probe_svg_cubic_split_state.py <output.json>` verifies package-part identity,
SVG/path/case consistency, native reference hashes and exact geometric equivalence
using rational Bernstein evaluation at four distinct parameters on each half.
The resulting degree-three polynomial identity covers each entire half.

`api-cases.json` contains sixteen separate original half-curves.
`native-api.json` is their hash-bound GDI+ Flatten(null, 0.25) reference captured
with `tools/capture-cubic-flatten-sweep.ps1 -QuantizeInput`. API references and
the native DOCX raster references are separate types of evidence.

The separate native picture reference uses the exact helper-opened
scratch copy and `tools/capture_open_picture_metafile.ps1`; Saved state and source
hash were unchanged. No save, selection, view change, close, Quit or font access.
`tools/record_svg_group_cubic.py --fixture svg-cubic-step-split` extracts the
eight PNG layers and records complete source/case/capture/image hashes.

The native full and split representations have equal layer sizes and origins
but differ at seven alpha pixels in three layers. Their API contours differ at
seven vertices in five curves. Current full and split contours are identical,
and the renderer matches all sixteen native half-contours and all eight split
native RGBA layers exactly. The full-curve compatibility discrepancy stays open.
The new regressions require this native agreement, source/package preservation,
editing, export/reopen, host cleanup and byte-exact undo. They do not require
known wrong full-curve pixels to remain wrong.
