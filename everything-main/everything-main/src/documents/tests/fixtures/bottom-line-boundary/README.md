# Automatic line spacing at the bottom of a page

`tools/bottom_line_boundary_fixture.py` independently authors all document XML,
styles, settings and OPC relationships. There is no corpus artwork, copied
corpus markup, font binary or application-generated DOCX in the fixture.

Each section has a tall table followed by a 3 pt Arial Bold paragraph and a
suppressed empty section-boundary paragraph. The available body height is 11599
twips. Varying the table's minimum height leaves the stated number of twips for
the test paragraph. Empty paragraphs and visible `x` paragraphs are paired.
The 58 controls cover automatic spacing at 0.5x, 1.15x and 2x, plus 79-twip
exact and minimum spacing. An ending section makes every overflow observable.

The reference application opened the exact file read-only and exported the
87-page reference using `tools/export-reference.ps1`.
`tools/record_bottom_line_boundary.py` independently extracts case start pages,
visible test-glyph pages and the following section's start from that PDF, and
records source/reference SHA-256 hashes. The unmodified app produces 99 pages.

Native boundaries:

- At 1.15x and 2x, 68 twips remaining overflows; 69 twips fits. The reference application uses the
  natural line extent at the bottom edge rather than the full automatic advance.
- At 0.5x, 34 twips overflows and 35 fits. Compression retains the smaller extent.
- Exact and minimum 79-twip lines overflow at 78 and fit at 79.
- Empty and visible paragraphs have the same boundary in every paired control.

ECMA-376 Part 1 section 17.3.1.33 defines automatic spacing in 240ths of a line
and exact/minimum values in twips. The supplied PDF was inspected at physical
pages 256-261. These controls establish the reference application's page-fit behavior; they do not
justify rounding all measurements, adding a global overflow tolerance, changing
saved spacing, or collapsing the advance between adjacent lines. A production
fix must also preserve keep/widow constraints and existing table pagination.
