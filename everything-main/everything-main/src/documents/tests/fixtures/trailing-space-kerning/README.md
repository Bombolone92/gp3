# Following-space kerning at line boundaries

`tools/trailing_space_kerning_fixture.py` writes original OOXML, using only the
minimal independent row-keep package shell. It does not copy corpus XML or
include font binaries. The reference application exported `native.pdf` without saving the
source. `reference.json` binds the exact DOCX/PDF/cases bytes and records
native table widths obtained from the repaginated, read-only reference document.

Nineteen cases distinguish a following ordinary space, double spaces,
identical-format split runs, a color-only split, a different font, disabled
kerning on the following space, disabled/below-threshold kerning on the word,
paragraph end, manual line break, tab and AutoFit minima. Arial bold, Arial
regular, Times New Roman italic and Calibri provide different pair behavior.
Native line text removes whitespace only for comparison: the tab is a layout
advance rather than a glyph. Line boundaries remain separate assertions.

At 20pt Arial bold, OPERATIONAL alone measures about 2881.444 twips in the
browser. Including its following space, then excluding that space's advance,
gives about 2874.217 twips. The reference application therefore fits the complete word at 2875 twips
only with that kerning context. AutoFit uses 2875 with the space and 2882 at
paragraph end. The fixed-width terminal/break/tab/font/disabled controls still
split the word. This follows the font's kerning; there is no word/font-specific
offset or universal overflow allowance in the renderer.

ECMA-376 Part 1 section 17.3.2.19 (`kern`) supplies the threshold; sections
17.4.52, 17.4.63, 17.4.71 and 17.18.87 specify table layout and preferences.
No reference/spec divergence is established. Native measurements establish the
shaping context and upward rounding of an AutoFit content minimum.

The browser regression checks every native line boundary and cell width,
then checks no-edit bytes, a body edit, unrelated parts, exact undo and reopen.
All three native/browser page pairs were inspected. The native reference splits one
row across a page where the browser keeps it together; pagination positions
are not asserted as identical by this focused fixture.

Regeneration requires a fresh reference export and native width capture before
updating the reference. The separate 20-case `native-fit-boundary` control is
also exercised by the browser test.
