# Ordinary outlines on 3D pictures

`tools/canvas_picture_3d_outlines_fixture.py` independently patches our original
`picture-3d.docx` OPC/XML with ordinary DrawingML outlines. It adds four paired
cases to isolate flat/deep outlines and round joins. The original four-color
PNG, page geometry and camera/material settings are reused; no editor export
or third-party engine generates the source. `cases.json` and `lines.json`
describe all seventeen cases. `native.pdf` and `native-properties.json` were captured
from the exact source in the reference application without saving it.

Regenerate measured colors and full silhouette boundaries with
`python tools/picture_3d_reference.py picture-3d-outlines`.
`reference.json` binds these measurements to the DOCX SHA-256. The browser
test checks all seventeen pictures, surrounding edits, exact ZIP-entry undo,
and export/reopen. Source media and DrawingML stay atomic on export.

## Native reference compatibility findings

- ECMA-376 Part 1 §20.1.2.2.24 describes omitted line width as zero. The reference application's
  picture outline instead defaults to 0.75pt, confirmed by COM `Line.Weight`
  and the independent raster. `noFill` disables the outline despite its width.
- §20.1.10.39 defines `ctr` as centered on the path. In the reference application's 3D picture with
  both extrusion and contour zero, the line extends fully outside the original
  frame. The explicit `algn="ctr"` flat rectangle proves this is not merely an
  omitted-attribute default. With extrusion or contour present the line is
  centered. The flat case expands the centerline frame by half a line width on
  each side before stroking it; it does not resize the source photograph.
- §20.1.8.52 defines round line joins. The default and explicit-round wide,
  extruded rectangle produce identical native picture rasters with sharp outer
  corners. Flat rectangles use rounded stroke corners. The painter follows
  these observed 3D behaviors, independently of ordinary two-dimensional shapes.
- A visible ordinary outline is lit using the same material as the face. Its
  color supplies the default extrusion color. The separate 3D contour remains
  unlit and follows the outside of the outlined solid; wide ordinary outlines
  remain visible inside it. One ellipse has matching outline/contour colors,
  while the other cases use different colors to expose occlusion mistakes.

The ellipse stroke uses its true parallel curve, rather than treating a larger
ellipse as an exact constant-width outline. Closest points and surface normals
come from the ellipse constraint; rectangular/circular cases have analytic
intersections. This is original geometry code. Dashed/compound lines, inset
alignment, unsupported caps/arrowheads and other unimplemented styles still
reject before editing. The tests establish bounded raster agreement, not
pixel-identical browser output.
