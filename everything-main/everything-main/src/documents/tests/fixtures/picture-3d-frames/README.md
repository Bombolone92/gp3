# 3D pictures with different inner and outer extents

These 24 controls are independently authored by `tools/picture_3d_frames_fixture.py`
from the project's original picture fixture, without corpus artwork or engine
imports. The reference application exported `native.pdf`; the independent reference extractor
records source/PDF hashes, color neighborhoods and silhouettes.

The outer frame is 144 by 108 points. Inner frames are 144 by 108, 288 by 216,
72 by 216, and 288 by 54 points. The last two paint 36 by 108 and 144 by 27
points respectively, aligned at the outer frame's top left. The reference application uses a uniform
contain fit before creating the solid. The 12-point bevel width and 6-point
height do not scale with the inner-to-outer ratio. Matching and doubled inner
frames therefore render identically. Rectangles, ellipses, a perspective camera,
disabled aspect locks and inline pictures establish this independently.

ECMA-376 Part 1 sections 20.1.7.3/20.1.7.6 specify inner extents/transforms;
20.4.2.7 specifies the final outer drawing dimensions. Those descriptions do not
specify this contain-fit reconciliation. The reference application's behavior differs from reading
the outer dimensions as requiring the painted shape to fill both dimensions.
We retain the outer dimensions for layout and preserve both original extent
records in the package. Only the temporary painted scene uses fitted dimensions.

The comparisons retain the existing 1.25-point silhouette allowance and four-level
color tolerance used by independent 3D/bevel tests. Native color neighborhoods
account for raster sampling at boundaries; JPEG references compare luminance,
as in the established bevel controls. They are not pixel-identity certification.
Rotations, flips, nonzero inner origins and unsupported cameras remain guarded.

The inline controls use explicit line boxes and a one-point paragraph mark so
installed-font differences do not determine the image placement. Text/font
fidelity is covered separately. The reference application's decoded image pixels are identical for
all nine equal/doubled and locked/unlocked pairs.
