# Thin shape outline diagnostic

Original OOXML rectangles and ellipses derived from this repository's original
shape-defaults OPC fixture. The generator removes text and inactive effects,
uses explicit no-fill and RGB C0C0C0 round outlines, and varies declared width.
The reference application exported the private reference through export-reference.ps1.
Source XML passes Transitional and supported MS-ODRAWXML schema validation.

This is an unresolved rendering diagnostic, not a passing fidelity claim.
The 1588 EMU declaration (about .125pt) becomes a .14pt PDF pen. The other
native pens are .25, .34071 and .5pt, matching declarations. The small-width
rounding needs further boundary controls before being called a general
compatibility rule. No compensating pen-width change has been implemented.

The engine's two-stage Canvas rendering produces lighter integrated ink,
especially for curves. reference.json records the observed app/native
ratios for the eight shape regions. These are diagnostic measurements, not
acceptance thresholds. Native PDF was rendered at 4x then downsampled with
Lanczos to the app's 816x1056 canvas; integrated RGB darkness was measured in
each shape frame expanded by 5pt. This excludes the caption and editor caret.
Further isolation must distinguish stroke rasterization from intermediate
bitmap sampling without altering the declared pen or regressing existing art.

The source monthly meal planner (#226) has 474 declared .34071pt outlines;
the reference application's visible PDF paths use that same width and gray .753. All 34 text lines
match, but decorative contrast remains visibly different. The source remains
partial. Source-specific adjustments are not an acceptable fix.


Follow-up correction: Lanczos resizing added dark ringing around the light
strokes and exaggerated the initial ratios. The reference JSON now also records
integrated ink measured before PDF resampling, normalized by pixel area. This
puts the .34071pt rectangle at about .987 and ellipse at .915 of native ink.
The planner's top band is 0.829 of native ink by the corrected method.
Direct Canvas rasterization reproduces the ellipse loss; high-quality bitmap
filtering did not materially change it and was not retained. The remaining
curve antialiasing discrepancy is smaller than the initial comparison implied.
See minimum-outline-width for the separately proven and implemented native pen
floor. That floor does not affect the planner's .34071pt strokes.

Live-screen follow-up (2026-09-30): the independent
[outline display controls](../outline-display-width/README.md) confirm a separate
screen-space minimum and integer pen/position quantization in the reference application. The PDF
continues to use the physical widths described here. This explains additional
live-display contrast loss and means PDF-only comparisons are insufficient for
the screen fix. The original curve-coverage difference remains open; no width
compensation or runtime change accompanies these new references.
