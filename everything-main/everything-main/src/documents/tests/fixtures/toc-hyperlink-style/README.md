# Native TOC Hyperlink-style exception

Generate with `python tools/toc_pageref_fixture.py --hyperlink-style`.
This is original test content, with no corpus assets or embedded font files.
The style named Hyperlink has the noncanonical ID `LinkStyle`, based on Default
Paragraph Font, and declares Times New Roman, 16pt, italic, blue and single
underline. The first two TOC labels use it; the second also has direct red color
and double underline. The third label uses a custom character style. The same
labels/styles occur as headings outside the TOC on the following pages.

The reference application exported four pages from the read-only source without saving.
Within the TOC, the first label uses Times New Roman at 12pt, upright and black
without underline. The second retains its direct red color/double underline.
The custom style applies fully, as does the built-in style outside the TOC.
PAGEREF results are locked and keep their directly formatted cached values.

This is a reference-specific exception to the general character-style hierarchy in
ECMA-376 Part 1 17.3.2.29; the TOC field is defined in 17.16.5.68. The preview
retains font families but suppresses the built-in style's other properties in
the TOC result, then applies direct formatting. It uses field context and the
style name, not a source filename, style ID or fixed positioning adjustment.

`tools/reviewed_font_reference.py toc-hyperlink-style` binds source/PDF hashes
and records native glyph positions. Browser checks compare text and positions
within 0.3pt and verify contrasting inside/outside paint styles. Source and
downloaded XML parts pass schema validation. No-edit ZIP parts remain exact.
The control is now editable with the same rendering. Field context is recomputed
after character-style changes or removal of the TOC, so suppression cannot leak
into ordinary text. Export/reopen and exact undo are tested.
