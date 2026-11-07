# Curved ellipse regeneration controls

Original project-authored XML and quadrant artwork; no corpus artwork or
third-party engine code. Generate with `tools/sketch_ellipse_fixture.py`.
Twenty-three ellipse pictures and three rectangle boundary controls vary
width/height, unsigned seed, zero/nonzero outline width, and invisible outlines.
Cases 16–19 were added after deriving the formula
to check noFill outlines, odd dimensions, a tiny ellipse and additional seeds.
Cases 20–25 cover the 10000-unit path-grid threshold, including mixed axes and
exactly 10000 units. Both axes use that grid if either extent is below 10000.

The reference application exported four PDF pages and a separately saved DOCX
using `tools/export-reference.ps1`. Extract saved coordinates using
`python tools/extract_sketch_geometry.py tests/fixtures/sketch-ellipse`.
native-recording.json binds the controls and output bytes with SHA-256 hashes.

Native ellipse construction rounds its radii and cubic controls first. Each
segment's perturbation limit depends on its control-point separation and final
handle length. MT19937 draws determine a radius and angle for each control;
fill draws precede stroke draws. All tested coordinates match exactly, including
the noFill cases: suppressing the outline does not disable fill regeneration.
The seed, type and geometry semantics are defined in MS-ODRAWXML 2.38.3.2,
2.38.3.3 and 2.38.4.1; these numerical rules come from native controls rather
than a published numerical algorithm. This is not a claimed spec divergence.

Supported sketches may now be retained as complete objects in editable
documents. Text edits preserve their XML and regenerated geometry. Changing
the drawing internals or size remains guarded. Freehand/scribble, saved custom
geometry and ambiguous/missing seeds remain outside this subset.
