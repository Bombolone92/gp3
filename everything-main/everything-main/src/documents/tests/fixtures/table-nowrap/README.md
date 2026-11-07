# AutoFit cell noWrap controls

`tools/table_nowrap_fixture.py` authors `public/fixtures/table-no-wrap.docx`
directly as OOXML. All text and colored cells are original. The minimal styles
part has its own relationship and content type. `native.pdf` is the reference application's 28-page export, closed without saving the source.
`tools/record_table_nowrap.py` measures cell fill rectangles and records both
source and PDF hashes. Multiple paragraph fill rectangles are combined when
finding the top of each cell; widths are measured from the PDF, not the app.

The first twelve cases cross fixed/AutoFit table layout, dxa/auto/pct cell
widths, and explicit noWrap false/true. Subsequent pairs vary absolute widths
(60, 90, 180 pt), text sizes (8 and 16 pt), a short neighboring cell, page-limit
pressure, and two long unbroken strings with/without noWrap.

ECMA-376 Part 1 §17.4.29 defines noWrap as an AutoFit sizing input: dxa cells
protect their preferred width; auto/pct cells measure without soft breaks.
It does not switch off wrapping in the final cell, and fixed layout ignores it.
Inherited table/conditional cell properties and explicit false are supported.

Native reference behavior: a protected dxa minimum includes an additional 17 twips
(0.85 pt). The measured widths are 60.84, 90.84, 120.86 and 180.86 pt, including
120.86 pt at 8, 12 and 16 pt text. It also occurs without neighboring pressure:
The reference application assigns 120.86/119.18 pt within the 240pt table. This allowance is not
specified by §17.4.29; the implementation follows the independently reproduced
native behavior rather than treating the nominal preference as the exact minimum.

When unbroken minima exceed the available page width, the reference application proportionally
compresses whole widths. The last two controls have 200/400pt unbroken text
and render at 156.02/312.07pt within 468pt. Subtracting per-grapheme floors before
scaling incorrectly changes the proportions. Hard glyph/padding floors remain
enforced when proportional compression alone would violate them.

Browser tests compare all cell left edges/widths within 0.5pt of the reference application, check
painted fills along three vertical strips per cell (avoiding reliance on one
pixel landing between glyphs), edit/export/reopen, and undo to exact OPC parts.
Unit tests cover explicit on/off spellings, malformed markup, style inheritance,
hard line breaks, fixed-layout exclusion, row insertion, serialization without
a retained cell shell, and proportional compression. These controls do not
claim support for conditional row properties, which remain a separate corpus
rendering gap.
