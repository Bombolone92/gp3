# Native curve placement controls

These original OOXML controls extend the #226 meal-planner outline investigation.
`tools/outline_curve_display_fixture.py` emits `control.docx`; run it again with
`--phase-boundaries` for the holdout. Neither uses the renderer's serializer.
Each has sixteen opaque C0C0C0 shapes and a 4327 EMU pen: preset ellipses,
equivalent four-cubic ellipses, open cubics and triangles. Initial offsets vary
by 0/.25/.5/.75 CSS px; the holdout uses .49/.51/.53/.55 px.

Private copies were opened through the reference-application helper and confirmed by exact
path. The reference application displayed all objects without repair. Captures use
100%/200% zoom, with the pointer outside the artwork. Page origins come from
visible paper edges, not optimized artwork registration. At 200%, the blank
page bottom is below the viewport; all measured shape regions remain visible.
The recorder rejects colored overlays throughout those regions.

**The screenshot tool returns JPEG.** PNG crops retain its decoded artifacts.
The reference records original format, quantization tables, subsampling, sizes
and hashes. Threshold-240 bounds are descriptive, not exact curve or opacity
assertions. Raw canvas PNG versus decoded JPEG ink totals cannot establish a
coverage multiplier. Preset/explicit-cubic ellipse patches match in three initial
100% rows; the half-pixel row differs slightly and is not declared equivalent.

The native Save As PDF export independently establishes physical placement.
All sixteen positive page-relative offsets match `trunc(EMU/635)/20` points;
the pen remains .34071 pt. The .49/.51/.53 px rows have a .35 pt fractional
origin; .55 px has .40 pt. Direct pixel rounding therefore misses the 100%
screen transition. The original DOCX entries remain intact.

ECMA-376 Part 1 §20.4.2.12 (`posOffset`) and §20.4.3.3 specify EMU offsets;
the supplied text was read at PDF page 3133. The reference application's observed whole-twip precision
loss is a compatibility discrepancy, not a reason to alter serialized offsets.
Physical pen widths remain governed by §§20.1.2.2.24 and 20.1.10.35.

Unit tests bind source/package/crop/PDF hashes and check native physical
placement. The earlier expected failure became a passing regression with the
signed offset correction (see `../anchor-offset-precision/README.md`). Browser checks capture both zooms and
exercise editing, exact no-edit/undo export, unrelated-part preservation and
reopening. Screen-pen handling and corpus promotion remain open.

Run `record_outline_curve_display.py <private-work-dir>` after native capture.
The isolated candidate tool accepts `OUTLINE_FIXTURE_DIR`,
`OUTLINE_FIXTURE_NAMES=control,phase-boundaries`, and `OUTLINE_ZOOMS=1,2`.
Its width/frame/point-rounding modes remain unshipped experiments.

The signed offset controls now cover page/margin/column/paragraph bases, cells
and groups; layout applies the confirmed conversion while retaining source
values. Native story-specific precision controls remain open. Next evaluate
screen pens at confirmed positions, separating
JPEG artifacts from rasterization differences. Do not tune opacity/registration
against the planner screenshot. Rotation, compound/dashed strokes, transparency
and effects still need controls before general screen-pen handling ships.
