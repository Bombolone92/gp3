# Shadows and patterned fills below a collapsed group axis

`tools/zero_axis_group_effect_fixture.py` independently authors two flat lines
with 10 pt green shadows and two patterned rectangles, all below a truly
singular group scale. The reference application opens the exact file read-only,
repaginates and exports the one-page reference PDF.

`tools/record_zero_axis_group_effects.py` measures outline/shadow color bounds
from a 4x native PDF raster and records source/reference hashes. The reference application retains
the 2 pt physical outline and 10 pt shadow displacement despite the zero axis.
The collapsed rectangles retain their outline but have no patterned fill area.

The browser comparison uses native ink bounds with a one-point raster tolerance,
checks that no blue/yellow patterned area is invented, and exercises editable
load, unchanged package export, insertion, exact undo pixels and export/reopen.
