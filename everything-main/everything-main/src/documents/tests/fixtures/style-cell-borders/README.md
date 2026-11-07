# Table-wide style borders and physical page cuts

`tools/canvas_style_cell_border_fixture.py` manually authors OPC/XML using the
independent row-border probe shell. It does not use the Documents serializer.
Arial 12 pt, a 5-inch-high page, a repeated header and 80 numbered body
paragraphs make the page cuts observable without ambiguous repeated text.

The table style declares a 1.5 pt double green table top border and a 1 pt
magenta cell top border. Its first header cell directly declares a 1.5 pt blue
dot-dot-dash top border. The reference application ignores the table-wide style's magenta tcBorders;
the other header cell uses the green table border. The row reserves the widest
effective top border, moving both header texts by 3 pt relative to the former
incorrect implementation. The 2 pt triple bottom borders occupy 10 pt of ink.
At physical page cuts the native reference reserves their full width, not the half-width of a
shared logical row boundary. Both behaviors are needed for the ten-page result.

The reference application opened the independently authored probe and the promoted fixture
and exported `native.pdf` and `native.xml` without saving the DOCX. Both captures
have identical text origins, and both source packages have equivalent XML
(canonical XML equality). `positions.json` contains
all nonempty native reference PDF text origins in points, with zero-based pages. Browser
tests compare page membership and both coordinates within 0.2 pt, then exercise
editing, package-part preservation, byte-exact full undo, canvas restoration
and reopening. Arial must be installed to run this reference comparison.

This is a documented divergence from ECMA-376 Part 1 §17.7.6.9:
[MS-OI29500 implementation note](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/9e742550-b438-4b9d-9606-4ae34d83830f).
Source styles remain byte-identical, including ignored declarations. This rule
does not apply to direct cell borders or claim support for conditional styles.

The existing mixed-border fixture also now places its edited long row on the
same pages as the reference application (nine pages total). It still has small earlier merged-row
offsets and a 2.7 pt oversized-row text discrepancy; its page-count regression
is not evidence of complete pixel equivalence for that fixture.

The initially observed continuation border about 18 pt too low is corrected
by content-based fragment bounds. Additional native probes for merged spans,
empty neighbors, minimum heights, shading and paragraph spacing are recorded
in `../row-fragment-ends/README.md`, along with the remaining discrepancies.
