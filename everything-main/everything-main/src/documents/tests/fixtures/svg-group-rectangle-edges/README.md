# Native rectangle coverage and group bounds

Six independently authored translucent groups contain sharp rectangles at
integer, quarter, eighth and half coordinates. Both odd and even half-bound
ties are represented, along with a .75 control to distinguish rounding from
flooring. `tools/svg_group_rectangle_edges_fixture.py` authors the DOCX/SVG;
the first inline range was captured read-only in the reference application with
`tools/capture-svg-group-raster.ps1`, then extracted by
`tools/record_svg_masks.py CAPTURE.emf svg-group-rectangle-edges`.
Source, native EMF and all six PNG hashes are in metafile-reference.json.

The reference application's raster bounds round to nearest with exact half ties downward. The
8-by-4 rectangle sample grid includes the top and left boundaries and excludes
the bottom and right. The old point-in-path fallback included all boundaries;
the first integer rectangle had 77 wrong alpha pixels, maximum error 32.
The corrected rectangle coverage and bounds match all six native alpha rasters
exactly. Rounded rectangles and other paths retain their existing sampling.

The browser test checks every alpha pixel, exact bounds, native hashes, source
XML preservation and cleanup. General source/edit/undo/reopen coverage uses the
existing SVG opacity/reuse tests and an additional full fixture workflow.
This is reference-compatible raster sampling, not a change to authored SVG geometry
or group opacity semantics. No source media is replaced in saved DOCX files.
