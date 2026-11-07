# Encoded marker automatic line spacing

`tools/encoded_marker_lines_fixture.py` authors 24 original OPC/XML controls;
`tools/record_encoded_marker_lines.py` records their 96 native body baselines.
The retained PDF was exported from read-only sources by the reference application.
Source/PDF hashes are recorded in `hashes.json`. No fonts are redistributed.

The controls vary Franklin Gothic Book/Arial 10pt body text, Symbol encoded
U+F0B7 at 10/20pt, Symbol Unicode U+2022 at 20pt, Arial bullets at 10pt, and
0.75/1/1.5 automatic line multiples. Explicit line breaks separate first-line
marker metrics from word wrapping; a following unnumbered paragraph checks the
accumulated vertical position. A taller marker raises the first baseline, but
the additional/compressed automatic spacing uses the body text metrics. Its
extra ascent must not itself be multiplied by the paragraph's line multiple.
Before the fix, the expanded large-marker controls drifted by over 5pt.
Afterward all 96 native baseline errors are below 0.16pt.

All 24 rendered pairs were inspected. Unicode U+2022 in Symbol retains the
known missing-glyph divergence (the reference application shows a box; the app uses its readable
bullet fallback); these are line-metric diagnostics, not glyph-fidelity claims.
The encoded glyph controls retain their intended Symbol bullets. The separate
existing bold-Symbol raster test fails by the same 0.625pt-squared area on the
committed baseline and this change; its tolerance has not been weakened.

Unit regressions verify independence from the line multiple, caret hit testing,
package preservation, editing, reopening and undo. Browser tests compare all
native baselines within 0.25pt, preserve layout through undo, and edit/export/
reopen the 24-page control. The relevant specification is ECMA-376 Part 1
§17.3.1.33 (automatic spacing in 240ths of a line). Marker contribution is
measured reference behavior; no additional normative contradiction is asserted.
