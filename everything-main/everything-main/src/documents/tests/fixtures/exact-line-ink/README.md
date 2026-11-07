# Exact-line ink clipping

`tools/exact_line_ink_fixture.py` manually writes original OOXML and generates
an original solid cyan PNG. The one-page control contains 24pt Arial text in
12pt exact lines: ordinary text, a red underlined/highlighted run, a picture
beside text, a picture alone, raised/lowered text, and two adjacent tall lines.
The reference application exported `native.pdf`; the full native and browser pages were
visually reviewed. The independent reference script scans the reference application's colored ink
and retains source/PDF hashes plus nine vertical ink-bound measurements.

ECMA-376 Part 1 §17.3.1.33, printed page 250, describes clipping short lines
from the top. The reference application instead allows glyphs and underline ink outside the exact
line box, including overlapping adjacent glyphs. It still clips highlighting
and inline pictures. The engine follows that measured distinction. Existing
cell/page clips, hidden empty section boundaries, picture hit testing, caret
geometry and line advances retain their separate bounds.

Browser tests compare all nine ink bounds within one point when Arial is
installed. On platforms without Arial the native glyph comparison is omitted;
highlight/picture bounds and editing/preservation checks still run. The test
checks no-edit packages, edits, unrelated parts, undo and reopen. No private
corpus text, artwork or font files are included.
