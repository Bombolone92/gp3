# Filled-shape screen controls

Original independent DrawingML from `tools/outline_fill_holdouts_fixture.py`.
The two packages each contain 16 shapes, varying phase (0, .25, .5, .75 CSS px)
and geometry (rectangle, closed cubic ellipse, open cubic with implicit fill
closure, triangle). Fill is opaque D5D5D5; the physical outline is 4327 EMU.

`combined.docx` places fill and outline on the same shape. `group.docx` groups
each unoutlined fill with a separate thin line beneath it, making them share a
raster without sharing a shape outline. This isolates the planner's mixed-fill
regression from its complex artwork. These are original shapes, not extracted
template artwork or another engine's serialization.

The reference application opened both packages without repair. Native 100%/200% screen observations
were captured on 2026-09-30 at 1280×752. Page origins are (439,310) and (247,212).
The latter capture shows 517 vertical page pixels, sufficient for every measured
fill and line. `reference.json` binds source packages, case manifests and
crops. The recorder checks the exact package parts of the files opened in the reference application,
and rejects colored cursor/overlay pixels in the measured regions. Crops derive
from JPEG, so they are not exact antialiasing/opacity oracles.

`tools/record_outline_fill_holdouts.py <private-work-directory>` records native
observations and the three isolated display experiments. The group controls
disprove changing only bitmap origin and stroke geometry. Independently rounded
fills repair groups but regress three outlined open-cubic observations. Sharing
the hinted stroke phase with its fill removes those failures: 59 of 64 regions
improve over baseline and five stay equal. No production renderer change ships
with these controls.

Relevant declarations: ECMA-376 Part 1 §20.1 drawing properties, fills and lines;
§20.1.7 group transforms; group/shape extensions in the published MS-ODRAWXML specification. The measured
screen-phase behavior is native evidence, not a new claim about a numeric rule
mandated by the specification. Gradient/pattern/picture fills, text, effects,
arbitrary zoom/DPR and nested nonuniform groups remain integration checks.
