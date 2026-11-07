# Exhausted cell paragraph indents

`tools/exhausted_cell_indents_fixture.py` authors the fixture directly as original
OPC/XML, without corpus text or another document engine. The middle column has
300 twips of fixed width, zero cell margins and half-point borders. Fourteen rows
exercise empty/text paragraphs, left/right/both indents, first-line and hanging
indents, negative and valid controls, center/right alignment and 1-point glyphs.

`native.pdf` is a read-only export of that fixture from the reference
application. `reference.json` records SHA-256 identities and native PDF text
positions, including glyphs retained in the PDF but clipped from its visible page.
Coordinates are points from the top-left page corner. The browser test matches
all 58 nonempty lines against these positions (0.2-point tolerance), checks the
14 middle-cell line counts, and checks clipped ink in the neighboring cell.
It inserts text into an exhausted empty cell, checks package preservation,
export/reopen and exact undo. Original and edited XML retain their indents.

The reference application retains the authored indented origin when the right writing edge is at or
before it. Each item then occupies a line, including spaces and tiny glyphs;
center/right alignment does not shift these overflowing lines. Text is clipped
at the physical cell boundary. Empty paragraphs still have a line. A fabricated
one-pixel minimum would incorrectly combine the tiny glyphs and is not used.

ECMA-376 Part 1 §17.3.1.12 specifies offsets relative to text margins and the
first-line/hanging distinction. It does not prescribe rejection when the two
edges cross or the exact fallback wrapping algorithm. This is documented reference
behavior in that unspecified case, rather than a claimed contradiction of an
explicit normative rule. Body paragraph validation is unchanged.
