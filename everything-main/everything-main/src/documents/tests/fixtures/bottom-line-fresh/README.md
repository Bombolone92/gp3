# Automatic line spacing on a fresh page

`tools/bottom_line_fresh_fixture.py` authors five sections containing 72 pt Arial
Bold letters A–E. It reuses only the independently authored styles, settings and
OPC parts of `bottom-line-boundary.docx`; it contains no corpus markup or assets.

A and B have 2x and 5x automatic spacing in an 83 pt writing area. Their natural
line extent fits even though their full advance exceeds that area. C uses 0.5x
spacing in a 50 pt area. D and E use exact and minimum 83 pt spacing respectively.
The reference application produces five pages, with one letter on each page.

Generate the source with `tools/bottom_line_fresh_fixture.py`, export the exact
source with `tools/export-reference.ps1`, then record PDF text and hashes
with `tools/record_bottom_line_fresh.py`. The native PDF is retained here.

ECMA-376 Part 1 §17.3.1.33 defines the spacing units. These controls supplement
the bottom-edge controls with the reference application's fresh-page fit behavior, without changing
the authored spacing or the advance used between consecutive lines.
