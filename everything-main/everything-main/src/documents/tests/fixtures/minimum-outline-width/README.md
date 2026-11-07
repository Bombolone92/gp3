# Native minimum single-outline width

These original OOXML controls establish the reference application's minimum painted pen
for single (`a:ln cmpd="sng"`, including omitted cmpd) shape and picture outlines.
The four-page shape file contains paired rectangles/ellipses for 16 widths.
The picture file varies the same boundaries across original picture paths,
including a dashed outline and translucent/overlapping textures.

Every declared width from 0 through 1778 EMU produces a .14pt native reference PDF pen.
1779 EMU produces .14008pt; larger values retain their declared widths. The
native recorder reads PDF graphics-state widths at stroke operators, not pixels.
Its source and PDF hashes bind the evidence. The generator reproduces the
source OPC parts, and the documents pass Transitional/MS-ODRAWXML checks.

ECMA-376 Part 1 section 20.1.2.2.24 describes the declared line width through
ST_LineWidth (20.1.10.35); it does not prescribe this .14pt rendering floor.
This is a recorded measured reference behavior. The existing separately
verified omitted-width behavior is unchanged. Compound outlines remain outside
this minimum rule and zero-width compound outlines remain guarded.

The importer retains declaredWidth when clamping the rendered single pen.
Text-frame spacing/autofit and picture-outline centerline offsets still use
the declaration; physical ink bounds and painting use the rendered width. The
first zero-width picture stroke rectangle matches the original 60,90,144,72pt
frame in the reference application; it must not acquire a .07pt centerline expansion. Source XML remains untouched through no-edit
export and undo. Editing unrelated text retains the outline declarations.
The browser control verifies equal rasterized pens below the native boundary,
including zero (which Canvas otherwise ignores when assigned to lineWidth).

This change does not resolve all thin-curve antialiasing differences. It adds
no bitmap resolution increase, resampling filter change, or pen compensation
for the monthly meal planner, whose widths already exceed the minimum.
