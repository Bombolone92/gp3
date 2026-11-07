# Thin/thick medium-gap border controls

Original OPC/XML authored by `tools/compound_border_variants_fixture.py
--medium-reverse`, using the project's original package scaffold. No corpus
content or third-party document engine is copied. The reference application exported
`control.docx` to the 14-page `native.pdf`; all fourteen native examples were
visually inspected. The matching recorder with `--medium-reverse` records PDF
path bounds, horizontal band widths and source/PDF hashes in `reference.json`.

Each page pairs paragraph and table borders on all four sides. Sizes are
0/2/8/13/24/48/96 eighth-points, with frame off/on. Native top bands use full
width, half-width gap, half-width ink, independently floored to 0.12pt with a
one-unit minimum. This reverses the existing thick/thin medium-gap style.
Frame-enabled vertical table bodies reverse separately from their corner caps;
the browser's native corner/interior sampling checks that distinction.

ECMA-376 Part 1 §17.18.2 (`ST_Border`), printed page 1342, has duplicated prose
in the thinThickMediumGap description. Its two-band illustration and enum name
agree with these native controls. We follow that interpretation and do not claim
a new rendering divergence. The exact quantized widths are native evidence,
not a claim that the standard specifies a 600dpi grid.

Unit tests compare native widths/gaps within 0.03pt (PDF path rounding), edit
paragraph/cell borders, preserve unrelated parts and undo exactly. Browser tests
compare ink away from raster boundaries at every corner and perform editable
export/reopen. The existing 42-page compound-border matrix remains a regression
fixture. Arbitrary mixed-pattern and merged-cell junctions are not exhaustively
covered by this one-cell control set.
