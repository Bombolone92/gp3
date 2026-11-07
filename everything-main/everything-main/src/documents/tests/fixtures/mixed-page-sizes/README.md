# Mixed section paper-size controls

`tools/mixed_page_sizes_fixture.py` manually authors this original DOCX,
without corpus content or embedded fonts. Four sections use Letter portrait,
Letter landscape, 6 by 10 inches, and 10 by 6 inches. Each has left/right body
text, wrapping, a 100%-width two-column table and an inherited right-aligned
PAGE footer. All section transitions are next-page breaks.

The reference application opened the source read-only and exported `native.pdf`
without saving. `tools/mixed_page_sizes_reference.py` records native glyph
origins/baselines and PDF page sizes. SHA-256 hashes bind source and PDF.
ECMA-376 Part 1 sections 17.6.13, 17.6.17 and 17.6.18 define the authored page
sizes and section properties. No reference/specification divergence was required.

Browser checks compare all native text, baselines within 0.2pt (inclusive,
with 1e-9pt floating-point epsilon) and origins within 0.3pt. Canvas dimensions
match each physical page, including at 150% zoom. Checks cover clicking right-
aligned landscape text, inserting a wide image at the landscape writing width,
source retention, edits, undo and reopening. A separate document-background
variant checks every canvas pixel at the page corner.

Unit checks cover cumulative page-height navigation, hit testing, section-sized
table insertion, percentage-table merge/split widths and retained section XML.
Existing multi-section page-setup and section-break editing restrictions remain;
this adds support for editing content in retained mixed-size sections, not a
new section-authoring interface.
