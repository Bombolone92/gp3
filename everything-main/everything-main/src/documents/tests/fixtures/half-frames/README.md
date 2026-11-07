# Half-frame preset controls

`tools/half_frame_fixture.py` independently authors eight `halfFrame` shapes
from the project's original shape-defaults OPC fixture. The controls cover wide
and narrow shapes, default and independent adjustments, negative/zero/oversized
values, horizontal/vertical flips and quarter-turn rotation. No template artwork
is copied. The one-page native reference was visually inspected.

`tools/record_half_frames.py` binds source/PDF/PNG hashes. Native/browser fill
and outline pixels are compared in both directions with one-pixel rasterization
tolerance, through insertion, exact undo and export/reopen. Package checks retain
all unrelated parts. The source and browser exports pass XML schema validation.

ECMA-376 Part 1 §20.1.9.18 (`prstGeom`), §20.1.10.56 (`ST_ShapeType`) and the
accompanying preset definitions specify the two arm thicknesses. Both default
to 33333/100000 of the shorter side. The vertical arm is capped at shape width;
the horizontal arm is capped where its inner corner meets the tip-to-tip
diagonal. The full rectangle is used for text. Native controls agree with these
rules, including degenerate outlines and the limiting triangle. No reference/spec
divergence was found. Zero extents and unsupported/invalid adjustments remain
guarded; arbitrary shape-point editing is not introduced.
