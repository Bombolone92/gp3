# Single-border table cross junctions

The generator directly authors six original three-row, two-column tables.
They compare thin black/thick white, thin blue/thick red, thick blue/thin red,
and equal-width blue/red, red/blue and white/black internal borders. Arial labels use installed fonts;
no template content or font binaries are included. The reference application exported
the exact DOCX without saving it, as a single page.

The reference application leaves both intersections in the first table white. Its colored controls
put the wider single border above the thinner one. At equal widths, the
horizontal border covers the vertical border, including when horizontal white
is lighter than vertical black. This is not the color-brightness tie breaker
used for competing edges along the same cell boundary. Previously group
insertion order changed the result across successive rows: the first white
crossing could appear correct while the second was overpainted by the later
black horizontal group. This reproduced corpus document 47's signature lines.

The PDF recorder finds both long black horizontal rules at 288 DPI and records
their crossing regions independently of browser layout. It also samples all
twelve intersection colors, including the gaps in the final vertical black
border. The reference binds source and PDF hashes. Browser checks compare
these pixels and repeat after undo and reopening, with package preservation
after editing. The former expected failure has been removed.

Relevant specification areas are ECMA-376 Part 1 §§17.4.38 (table borders),
17.4.66 (cell borders) and 17.18.2 (border styles). The shared-edge conflict
algorithm in §17.4.66 describes adjacent coincident cell edges, not the painted
overlap of orthogonal strokes. The implementation follows the independently
observed native junction rule; it does not change that shared-edge algorithm.
No contradiction with a separately specified cross-junction rule was found.

The fix subtracts the winning stroke's clipped rectangle from losing ink,
independent of painting order. Relative cut coordinates survive story
translation. It applies to four-way intersections of single borders. Existing
two-edge corners remain unchanged; compound, dashed and T junctions remain
outside this newly verified subset. Layout, hit testing and source XML retain
their original geometry and properties.
