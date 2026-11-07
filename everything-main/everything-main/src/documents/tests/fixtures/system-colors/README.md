# DrawingML system color reference

The original `tools/system_colors_fixture.py` creates 36 colored rectangles in
one DOCX page: all 30 ECMA-376 system tokens, four deliberately contradictory
`lastClr` values, a 50% tint and 50% alpha. `record_system_colors.py` samples the
independently exported native reference PDF. JSON records source/PDF hashes and 324 interior
RGB samples. The reference export was made after exact document-path confirmation,
without saving changes to the DOCX.

The reference application on this Windows host matches native `GetSysColor` values for all
30 tokens. Its saved-cache contradictions prove that `lastClr` is not an RGB
override. This agrees with ECMA-376 Part 1 §§20.1.2.3.33 and 20.1.10.58, rather
than establishing a reference/spec divergence.

The renderer uses this standard Windows palette for drawing system bindings.
Browser legacy CSS colors differ for several native colors, so app CSS, dark
mode and browser-specific legacy-color aliases are not used as document colors.
Custom OS palettes remain a limitation. This feature does not change the existing
cached theme-color reader, chart colors or 3-D material color restrictions.

Opaque interiors (315 samples) compare exactly. The nine translucent samples
use the existing alpha regression's one-level-per-channel allowance for
8-bit PDF/Canvas compositing. The 50% blue-over-white sample differs by one
red-channel level on this host; the underlying parsed alpha is tested exactly.
This allowance does not apply to base system colors or tint.
