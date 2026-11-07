# Native tab-leader geometry references

Browser tests verify first-glyph positions, counts, and advances for 76 cases.
One retained superscript case documents a separate script-metrics approximation.

`tools/tab_leader_grid_fixture.py` authors four original DOCX files directly as
OOXML, reusing the minimal original section-spacing fixture's package scaffold.
The first 60 cases across three one-page documents cover two fonts, five preceding
text lengths, two paragraph indents, two page margins, and all five ink-bearing
leader kinds. Each right tab is at 6000 twips and ends with `12`.

The PDFs were exported by the reference application. The corresponding
`.native.json` files retain PDF text coordinates, fonts, sizes, and SHA-256 hashes
of the generated source and PDF. Generated OPC part contents were checked equal
to those of the files actually opened in the reference application. All source XML parts passed
the official transitional schemas.

Observed behavior:

- Times New Roman 12 pt dots have a 3 pt advance. With a 72 pt left margin,
  `I` starts at PDF x=72.024 and the first dot at 78.024. Moving the paragraph
  indent 35 twips moves `I` to 73.824 but leaves the dot at 78.024.
- Moving the page margin to 75.5 pt produces a first dot at 81.024 (and 84.024
  with the indent). The grid therefore does not restart at the text end or
  left margin. The renderer now uses this page-relative grid.
- The reference application emits whole leader glyphs within the gap, leaving any remainder blank.
  The renderer now emits whole glyphs instead of filling past the gap.
- Arial 12 pt dots advance approximately 3.36 pt; hyphens and middle dots in
  both fonts advance approximately 3.96 pt. Underscores/heavy leaders also
  follow a grid, with advances dependent on font. PDF text spacing must be
  included when reading these values; nominal font widths alone are insufficient.

The fourth file adds 17 formatting cases: font sizes, positive/negative spacing,
horizontal scaling, superscript, bold, left/center/decimal tabs, and centered/right
paragraphs. Its coordinates were read from PDF Tm/TJ operators because pypdf's
text visitor incorrectly reported (0,0) for some chunks flushed after ET.

The probes establish 600 dpi rounding of font size, glyph advance, character
spacing, and the starting text coordinate. Glyph advance and spacing round
separately. Paragraph alignment shifts the positioned leader with the text.
Unit tests cover narrow gaps; existing browser tests cover tables, numbering
suffixes, undo, selection, and malformed-input preservation.

The reference application's Arial superscript uses different metrics from the existing generic script
transform. That row is explicitly excluded from native-reference assertions while
script formatting remains covered by existing tests. This is an open generic
script-metrics gap, not a template exception.

ECMA-376 Part 1 §17.18.85 requests complete filling of the tab spacing without
prescribing numeric phase or metric rounding. The reference application leaves fractional remainders
blank rather than painting fractional glyphs. These original probes support the
implemented compatibility refinement to that wording.
