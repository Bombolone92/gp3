# Oversized inline drawings

`tools/canvas_oversized_inline_fixture.py` independently creates six cases using
python-docx (MIT), lxml (BSD) and original Pillow-generated (HPND) pixels. They
cover left, center and right alignment in body paragraphs and fixed-width cells,
with text before/after pictures wider than their paragraph and cell.

The reference application exported the exact source to `native.pdf` without saving it.
`tools/oversized_inline_reference.py` extracts six picture rectangles and
records the source SHA-256. The reference application preserves physical image dimensions and starts
each oversized picture at the left indent on its own line, regardless of text
alignment. It does not shrink the picture, but clips its ink at the cell edge.
The body pictures show all 468 points; the cell pictures retain a 234-point
extent but show only 180 points. A following
space starts the next line. Horizontal origins and dimensions match the app
within 0.1pt. Font-dependent vertical baselines are not asserted by these tests.

ECMA-376 §20.4.2.8 defines inline placement and §20.4.2.7 defines the drawing
extent; the overflow treatment is reference layout behavior, not an identified
contradiction of an explicit overflow rule. Unit/browser checks cover pointer
selection inside the visible region, rejection of hits beyond the cell edge,
editing, export/reopen and exact undo.
Existing page-height and non-image text overflow guards remain covered.

The original recorder measured PDF image placement matrices, which describe
the full image even when a clipping path hides part of it. Its earlier claim
that the cell picture remained wholly visible was incorrect. The recorder now
also measures the rendered blue/orange pixels at each image's vertical center,
records visible horizontal bounds, and hashes the native reference PDF. Browser checks
compare actual painted pixel bounds with these independent measurements.
