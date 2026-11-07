# SVG viewport geometry — native reference and preview correction

`tools/svg_viewport_geometry_fixture.py` creates nine original controls using
the original SVG package generator. The SVG contains only a viewport-sized
blue rectangle and a centered orange rectangle. The magenta PNG fallback is
deliberately different. No corpus assets or third-party engine are included.
Each DOCX exercises full, cropped, grouped and shape-fill placement at the same
physical drawing size. Cases cover small, medium, fractional and odd dimensions,
overflow, shifted viewBoxes, physical units, ratio-only dimensions and percentages.

The reference application opened each exact source read-only, confirmed its full
path, and exported the retained one-page PDF without saving the DOCX.
`tools/record_svg_viewport_geometry.py` records source/PDF SHA-256 hashes, form
bounds, matrices and rectangle operators directly from those PDFs. Rectangle
operators include clipping rectangles as well as painted geometry; they must
not all be interpreted as painted bounds. The raw PDF remains authoritative.

| Authored SVG dimensions | First native form bounds (width × height) | Native integer viewport in internal units |
| --- | --- | --- |
| 16 × 12 | 2.0472 × 1.5682 | 1.92 × 1.44 |
| 80 × 40 | 9.7278 × 4.9191 | 9.6 × 4.8 |
| 120.5 × 80.25 | 14.659 × 9.7182 | 14.52 × 9.6 |
| 241 × 161 | 29.057 × 19.458 | 28.92 × 19.32 |

The existing stroke controls establish 0.12 internal units per intrinsic SVG
pixel. Every new full form starts the viewport at x=0.085025. The padded form
dimensions exceed the integer viewport; the extra amount varies with size.
Together with the existing 120 × 80 and 240 × 160 controls, these cases reject
a constant physical inset or an exact one-intrinsic-pixel extension as a full
description of the native behavior.

The fractional control also exposes integer viewport sizing before viewBox
fitting: its viewport is 121 × 80, while its viewBox stays 120.5 × 80.25. Default
aspect-ratio fitting therefore paints a narrower centered rectangle. In the
PDF, that rectangle begins at x=0.13755 and has width 14.415, inside the
14.52-wide viewport beginning at x=0.085025. This is separate from the outer
padding and must be accounted for by a general correction. It is an observed
reference export divergence from the authored fractional SVG sizing, not permission
to round DOCX picture extents or mutate embedded SVG bytes.

The nested `*-native.emf` files explain the variable margins. They were extracted
from the reference application's first inline shape's `Range.EnhMetaFileBits`, without using the OS
clipboard. `metafile-reference.json` records capture/nested hashes and native
header fields. The original EMF+ picture references a physical frame converted
back to device pixels, followed by one final device pixel. The captured device
is 4700×6200 pixels / 199×262 whole millimeters. With `u` as 0.01-mm units per
device pixel, the reference application uses `floor(-0.5*u)` and `floor((size-0.5)*u)` for the frame
edges. The source extent is their difference divided by `u`, plus one pixel.
This reproduces both the nested headers and the independently exported PDFs.

`svg-native-viewport.js` applies that native reference profile to the
isolated preview. It preserves the authored viewBox, percentage coordinates and
stylesheet tree, applies the frame transform to the root viewport, and clips
overflow before the new margin. Source SVGs, raster fallbacks and package parts
are unchanged. Root clips/transforms and excessive ratio-only raster dimensions
retain their previous path. Other printer/device profiles remain unverified.

Unit checks compare the generated frame with the retained native headers and
PDF forms. Browser checks compare both colored regions in all four placements
against native raster bounds, then test editing, exact undo, reopening and
package preservation. Existing SVG text, gradient, opacity, stroke and unsafe
resource regressions remain part of the required validation. Schema checks are
separate from these appearance and behavior checks.

Generate with `python tools/svg_viewport_geometry_fixture.py`; after native PDF
capture, run `python tools/record_svg_viewport_geometry.py`. Relevant standards
context: SVG viewport/viewBox transforms and intrinsic sizing, and the retained
`asvg:svgBlip` alternative representation. See the existing SVG picture and
thin-stroke sections in `docs/conformance.md` for references and current limits.

For metafile recapture, run `tools/capture-svg-viewport-metafiles.ps1` with a
scratch `-OutputDirectory`, then `python tools/extract_svg_viewport_metafiles.py`
with that directory. Only original controls are captured; no corpus artwork is
redistributed. Format/API references are linked in `docs/conformance.md`.

Validation: 70 focused unit tests and 27 browser tests pass (one optional corpus
case skipped). All nine source packages and 41 browser exports pass schema
checks. Production build and license gate pass. All nine native control pages
were visually reviewed; corpus document 77's four original pages and editing/package
preservation checks pass after the correction.
