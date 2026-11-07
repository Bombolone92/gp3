# Exploratory native diagram control

This is an independently authored OOXML probe, not a completed renderer test.
Generate with `python tools/diagram_layout_probe.py`. The package scaffold is
the project's original shape-theme fixture; no corpus diagram XML is copied.
`native.pdf` was exported by the reference application using
`tools/export-reference.ps1`. All three pages were visually inspected.

Each diagram supplies a data model, a simple linear layout with one text-layout
child and explicit width/height constraints, style/color parts and an intentionally
different cached drawing. Shapes are a green rectangle, purple ellipse and
orange chevron. Reading each drawing's SmartArt.AllNodes.Count before
repagination/export initializes its layout. All three then occupy the entire
200-by-100-point inline frame, instead of their smaller, offset saved shapes.
Opening and exporting the three-page file initially recalculated only the first
diagram. Separate one-page controls and unique layout/model ID controls isolated
this behavior: changing IDs did not fix it; initializing each SmartArt did.
This is evidence about this reference application build's loading/export behavior, not a
specification divergence or complete layout semantics.

An earlier independently authored composite-root control rendered blank. The reference application
saved it with an empty cached drawing and regenerated presentation nodes. Adding
the child traversal, text algorithm and model fill produced the present reference.
Do not treat arbitrary saved drawing geometry as authoritative reference output.

References: ECMA-376 Part 1 diagram data/layout semantics (section 21.4), and
[MS-ODRAWXML diagram schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/e1b56dd5-305b-4b3b-a983-28df1d4ffc3f).
The latter defines cached drawing groups, shapes and text transforms;
[dataModelExt](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/052211cd-4f97-4860-aeb1-3fee41317937)
identifies the saved drawing part and minimum layout version.

The schema checker now validates all four standard diagram parts and the saved
drawing against ECMA-376 and the published MS-ODRAWXML schema. It exposed missing
required style labels in the earlier probe. Those labels are now supplied, and
the regenerated native reference has no fallback black outlines. All parts pass.

Pending: derive further layout and style behavior, implement diagram rendering,
and add application edit/export regressions. No application support is claimed
by this native research fixture. The exporter currently initializes main-story
inline and floating diagrams, including grouped shapes; diagrams in other
stories need additional coverage.
