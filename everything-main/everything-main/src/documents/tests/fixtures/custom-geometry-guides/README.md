# Custom geometry guides

Original OPC/XML generated with the Python standard library by
`tools/canvas_custom_geometry_fixture.py`; no corpus artwork or outside engine.
The 20 shapes cover every guide operator, shape-vs-path coordinate systems,
connection sites, empty line ends and a custom inset text rectangle. A second
fixture changes four path starts to negative half coordinates while retaining
all other artwork. Both exact sources were opened in the reference application
and exported to the included one-page PDFs without saving.

`tools/custom_geometry_reference.py` (and `--negative`) extracts bar edges
from those PDFs at 288 dpi. Browser samples compare left/right extents within
0.6pt, including ink outside the nominal frame, then edit/export/undo/reopen.
The native reference PDF's inset text origin is x=369.31pt (text matrix); the browser checks
its horizontal placement within 0.2pt. This is not a claim about full text raster
or vertical baseline equivalence. Exact source hashes accompany references.

The small-grid arc-tangent cases resolve 22.5 and 67.5 to 23 and 68 path units.
The EMU-grid case retains the intermediate 62.5 percent. Negative halves resolve
to -1, -2, -3 and -4. These observations establish rounding at path consumption,
not at each guide calculation. The quadrant probes require atan2 rather than the
literal single-quadrant arctan expression in the specification. See conformance.
