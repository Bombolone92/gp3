# Native sketch-regeneration controls

Original project-authored XML and quadrant picture data; no corpus artwork or
third-party engine code. Generate with `tools/sketch_regeneration_fixture.py`.
Sixteen inline pictures vary saved preset (rectangle/ellipse), unsigned seed
(0, 1, 2, 12345), width and height. Duplicate cases verify determinism. The
initial materialized custom geometry intentionally remains the same two cached
rectangles while the saved sketch preset varies.

Use `tools/export-reference.ps1` with control.docx as SourceFullPath,
native.pdf as OutputPdf and native.docx as OutputDocx. This opens an owned read-only
reference-application instance, repaginates, exports PDF, then saves to a separate DOCX. Record
the reference application's version/build and SHA-256 hashes in native-recording.json after closing.
Run `tools/extract_sketch_geometry.py` to obtain the exact native saved paths.
Evidence tests bind the artifacts and extraction; no test requires our renderer
to retain a known mismatch.

The reference application saves two regenerated cubic paths per picture: a fill=none stroke contour
and a stroke=0 picture-fill contour. Duplicate inputs produce identical paths.
For a rectangle, changing only height leaves the first horizontal edge unchanged,
while doubling width changes normalized control points; scaling a cached curve
therefore cannot reproduce regeneration. Different seeds change the geometry.
The numerical output is evidence for implementation, not a lookup table to ship.

Curved rectangle and ellipse regeneration are implemented for retained drawings
and verified against this matrix, the independent sketch-heldout controls and
the sketch-ellipse size/outline/grid controls. Freehand, scribble, saved custom
geometry and ambiguous seeds remain unsupported. Supported drawings can be
retained during document text editing; changes to their internals stay guarded.

The published specifications document the stored original geometry and seed in
[MS-ODRAWXML §2.38.3.2](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/dafdccdc-343c-4cde-aa4d-8bfa3e8ad45f),
[sketch types](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/63cc0e50-04fc-41cf-9cbb-bd00cfabf70c), and
[deterministic seed semantics](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/a5fdcd3a-d82c-4a37-9917-92988c13350c).
The checked pages do not give the numerical generation formula. This is an
implementation gap, not a demonstrated reference/spec divergence.
