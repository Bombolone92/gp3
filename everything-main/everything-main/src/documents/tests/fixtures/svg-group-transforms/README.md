# SVG group transforms and geometry

`tools/svg_group_transform_fixture.py` authors four independent solid-fill
controls: a scaled rounded rectangle, an anisotropically scaled ellipse, nested
translucent groups around a scaled polygon, and an even-odd rectangular ring.
The 240×200 viewBox maps into a 120×100 intrinsic viewport. Each is embedded in
ordinary, cropped, grouped and shape-fill pictures by the original SVG builder.

The reference application captured the first inline range with
`tools/capture-svg-group-raster.ps1 -SourcePath <source> -OutputPath <capture>`.
`tools/record_svg_group_metafile.py <capture> svg-group-transforms` retains the
nested native metafile, exact embedded PNGs, source hash, image bounds, transforms
and alpha/color samples. These are pre-PDF pixels; no PDF color conversion is
used as a group compositing oracle.

The four native raster boxes are (9,3,78,6), (17,21,74,7), (4,46,79,8),
(4,69,100,14), expressed as x/y/width/height in the intrinsic viewport.
Browser checks compare positions, dimensions and mean alpha error directly
against the native PNGs. The rounded rectangle specifically tests exact sample
centers where Canvas's intermediate edge quantization otherwise adds coverage.
Original package and SVG bytes are checked through edit/export/undo/reopen.
