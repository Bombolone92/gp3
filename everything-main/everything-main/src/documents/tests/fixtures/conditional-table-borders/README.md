# Conditional table borders — native reference

`tools/canvas_conditional_border_fixture.py` writes the six-page source directly
as OOXML, without the application's serializer. The reference application opened the exact
source and exported `native.pdf` without saving the DOCX. The extraction script
`tools/conditional_border_reference.py` records painted PDF rectangles and
96 labelled cell text origins. Source/PDF hashes are in `manifest.json`.

Each case declares distinct colors for top, bottom, left, right, insideH and
insideV in a conditional tcPr. Cases cover firstRow, two leading header rows,
firstCol, two-row horizontal bands, two-column vertical bands, and a competing
direct table top border. The conditional cell border takes precedence over
the direct table top border. FirstRow applies separately to each header row;
band borders surround the band and use inside borders within it.

The reference application paints column-region insideH rules without adding their width as the next
row's own top writing inset. Row-region rules do add it. Keeping that distinction
corrects the accumulating 2pt-per-row offset observed during integration.

Browser checks cover all 96 text origins to 0.2pt and stroke interiors/extraneous
colored ink for first-row, first-column and direct-table cases. They exclude
crossing-stroke color precedence. Header and band cases have passing geometry
checks but do **not** yet pass every border color check: The reference application paints some upper
vertical pieces in the horizontal boundary color, whereas the engine retains
the vertical color. The original rectangles preserve these failures, including
the second header's roughly 8pt upper vertical sections. No source-specific
rendering rules have been added to disguise this gap. Further independent
probes are needed for compatibility modes, direct overrides and compound lines.

The document and styles parts pass the transitional OOXML schema. The fixture
does not establish complete conditional-border conformance, especially page
cuts and vertically merged regions.
