# Cell leading-space reference controls

The original sixteen-page OPC/XML source is authored by
`tools/cell_leading_space_fixture.py`. No corpus content or font binary is
included. The reference application opened the source read-only and exported
`native.pdf` without saving. `tools/reviewed_font_reference.py cell-leading-space`
records independent PDF text/glyph origins, bound to source/PDF SHA-256 hashes.

Compatibility mode 15 controls compare top, center and bottom cells with
0/2/6pt paragraph-before spacing, automatic/36pt exact rows and several cell
padding pairs. Pages 13-16 add contextual spacing, a shared paragraph style,
a repeated header and 11pt bold text. Page 13 shares the default style with
the preceding body heading; pages 14-16 use a different style for cell text.

ECMA-376 Part 1 section 17.3.1.9 says preceding same-style paragraphs suppress
contextual before-spacing. The reference application applies this across source cell and
table boundaries. On pages 14-16 the first cell retains its 2pt before-space,
while the subsequent cells suppress it. The first cell determines the row
height; the centered cell consequently moves about 1pt upward. Bottom alignment
still reaches the bottom. The ordinary spacing controls isolate this from a
general vertical-alignment or border-offset adjustment.

The browser regression compares all 64 text baselines and origins to native
PDF measurements within 0.2pt, then checks no-edit package identity, surrounding
edits, unrelated parts, undo and editable reopening. Broader contextual-spacing
regressions must also pass before a runtime change is considered verified.
