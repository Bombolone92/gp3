# Live screen versus native export phase

`control.docx` is an original two-page control built by
`tools/rotated_live_fixture.py`. Both pages contain one identical 108 pt wide
fixed table with six 10 pt Arial `a` glyphs in `tbRl` direction. Page 2 changes
table indentation from zero to one twip. The 144 by 180 pt sheet permits a
readable 500% live reference application view. Only the indentation and page label differ.

`native-0-500.png` and `native-1-500.png` are the observed reference print-layout views
on September 29, 2026. Zoom is visible in each screenshot. The second page
was reached with Ctrl+PageDown, with no document text edits. The window was
closed without saving. `capture.json` and both EMFs come from a separate
read-only reference `Range.EnhMetaFileBits` export of the same source.
There are no redistributed font binaries.

Run `python tools/record_rotated_live.py` to remeasure the stored evidence.
The recorder verifies every source part against the independent construction,
checks the bounded EMF mapping/font state, and hashes all input artifacts.
It isolates six black glyph components in the observed screen row, excluding
blue borders and red spelling marks, and records bounds and RGB ink centroids.
Screen component order is reversed to match right-to-left source order.

For the one-twip change, the native export's baseline shifts are
`[+0.12, +0.12, -0.12, +0.24, -0.12, +0.24]` pt. At this screen zoom those
would correspond to `[+0.8, +0.8, -0.8, +1.6, -0.8, +1.6]` pixels if directly
used as screen positions. However, all six screen glyphs keep identical
horizontal threshold bounds. Their horizontal ink-centroid changes are less
than 0.02 pixels. RGB crops are not byte-identical; this is not a claim of
identical rasterization or subpixel layout positions. The screen's vertical
scroll position differs by 25 pixels between the captures.

This rules out treating the observed 600 DPI export rounding as an established
device-independent live-screen rule. It does not prove why the reference application's paths differ,
that every zoom has identical behavior, or that the viewer's remaining native
PDF discrepancy is resolved. Keep corpus #338 partial. Do not introduce a
screen-position correction solely to fit the EMF data.

To recapture, generate the source, open it in the reference application's print layout view at 500%, and
observe both complete glyph rows without changing the horizontal scroll.
Record the actual window/crop/zoom when updating the screenshot analyzer.
Export the source separately with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/capture-rotated-spacing-phase.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/live-screen/control.docx" -OutputDirectory "$PWD/tests/fixtures/cell-text-direction/live-screen" -ExpectedTables 2
```

Source properties: ECMA-376 Part 1 §17.4.50 `tblInd`, §17.4.72
`textDirection`, §17.3.1.33 `spacing`, §17.6.13 `pgSz`, §17.6.11 `pgMar`.
The device rounding is an observed reference behavior, not a normative OOXML rule.

## Current viewer screen comparison — October 3, 2026

`tests/browser/cell-text-direction-screen.spec.js` paints this unchanged source
through the normal viewer path into two 500% canvases. It verifies the native
reference hashes and isolates the six black glyph bounds without translating
or aligning their ink. Native screen bounds stay unchanged between pages, but
three viewer glyphs shift by one pixel. The final native placement assertion
is an explicit expected failure; loading and extraction are ordinary checks.
The viewer's logical baseline translation is uniform at 1/15 CSS pixel.

This is a separate screen-rendering discrepancy from the exported GDI/PDF
baseline sequence. It does not prove a device-independent rounding formula,
and the browser/native glyph rasters are not identical. Further native screen
phases and zooms are required before altering the shared paint/layout path.
No renderer or tolerance changed.
