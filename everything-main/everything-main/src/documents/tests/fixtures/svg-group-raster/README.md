# Translucent SVG group rasterization — investigation

`tools/svg_group_raster_fixture.py` authors original thin overlapping paths in
five rows: opaque, group opacity 0.8, group opacity 0.5, fractional translation
with opacity 0.8, and nested 0.8 groups. The existing independent SVG fixture
builder embeds them as ordinary/cropped/grouped pictures and a shape fill.
The intentionally magenta fallback distinguishes SVG rendering from fallback use.
There is no corpus artwork or copied corpus markup.

The reference application exported the exact source to `reference.pdf` using
`tools/export-reference.ps1`. `tools/record_svg_group_raster.py` records
source/PDF hashes, form transforms and native image dimensions/placements.
The first form retains opaque paths as vectors and contains four soft-masked
raster images: 98×4, 98×4, 97×4 and 98×4 pixels. The fractional translation
changes the sampled bounds. Nested group composition remains a separate case.

The app currently keeps these groups vector-sharp and does not match the reference application's
edge coverage. Both full pages have been inspected side by side. Opening,
no-edit preservation, insertion, unrelated-part preservation, exact undo and
export/reopen pass; rendering fidelity remains unfinished.

[SVG 1.1 §14.5](https://www.w3.org/TR/SVG11/masking.html#ObjectAndGroupOpacityProperties)
requires group opacity to apply after group compositing. It does not prescribe
the reference application's low-resolution intermediate raster. This is a native fidelity behavior,
not proof that the standard requires a four-pixel strip. A fix must determine
sampling bounds, transform handling, nested composition and clipping from
independent controls, preserve original SVG/OPC bytes, and retain opaque vectors.

## Native metafile evidence

`tools/capture-svg-group-raster.ps1` captures the first inline range from an owned,
read-only reference-application instance without the clipboard. `tools/record_svg_group_metafile.py`
extracts its nested SVG metafile and original embedded PNGs. The native strips
are retained as `native-strip-1.png` through `native-strip-4.png`, with dimensions,
transforms, sample columns and hashes in `metafile-reference.json`.

The four image origins are (9,25), (9,43), (10,61), (9,80). Along with the widths
and heights above, these agree with rounding each geometry bound to the nearest
integer and adding one pixel on each side. A fractional translation crosses the
rounding threshold. These cases do not yet establish all scale/rotation/clip rules.

Native single-path alpha values cluster at quarter coverage. This is consistent
with the documented [GDI+ 8×4 antialiasing filter](https://learn.microsoft.com/en-us/windows/win32/api/gdiplusenums/ne-gdiplusenums-smoothingmode).
A scratch integer-origin 8×4 sample prototype reduces the first strip's mean
absolute alpha error from 17.75 to 3.01 byte values compared with ordinary browser
rasterization. It is diagnostic evidence, not a finished production algorithm;
edge quantization, nested composition and bounded rendering cost remain open.

The PDF embeds different RGB values than the original PNG: at one blue sample,
the PNG contains (63,127,191,51), while the extracted PDF image contains
(12,25,38,51). The latter RGB is approximately alpha-multiplied a second time.
Do not turn this PDF export discrepancy into a general SVG color correction.
The native metafile pixels provide the pre-export evidence for group rendering.
