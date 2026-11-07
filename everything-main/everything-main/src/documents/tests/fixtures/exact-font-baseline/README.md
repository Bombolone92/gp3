# Exact-line baseline control

`tools/exact_font_baseline_fixture.py` manually writes original OOXML for four
font families (Arial, Times New Roman, Courier New, Bebas Neue), two sizes
(12/24 pt), and three exact line heights (12/24/36 pt). Run and paragraph-mark
fonts are explicit. Each family starts a new page. The reference application exported the
four-page `native.pdf`; all four pages were visually reviewed. The reference
script records glyph baselines and source/PDF hashes independently of layout.

ECMA-376 Part 1 §17.3.1.33, printed page 250 (PDF page 260), says tall exact or
minimum lines center the text and short lines bottom-align it. The reference application diverges
for positive exact heights: every measured baseline is at 80% of the declared
height, within 0.05 pt of PDF output rounding, regardless of font or font size.
The engine follows this measured behavior. Automatic, minimum and zero-exact
line heights retain their existing metric-based treatment.

The short-line native reference PDF also prints glyph ink above the nominal line box.
The separate exact-line-ink control now establishes and fixes that behavior
while retaining inline-picture and highlight clipping. This matrix alone does
not establish behavior for unsupported vertical text or compatibility flags
such as suppressTopSpacing.
