# Square-wrap flow investigation

These original manual OOXML controls establish numeric square side wrapping.
No corpus text, logos or photographs are included. The green square
comes from the project's original generated header-drawing fixture.

`tools/square_wrap_flow_fixture.py` creates:

- `square-wrap-flow.docx`: four pages with left, right and central pictures,
  plus a picture anchored in a short paragraph whose exclusion extends into the
  following paragraph. Pictures use paragraph-relative vertical and column-
  relative horizontal numeric offsets, square wrapping on both sides, and
  nine-point side distances. A small square also appears in the footer.
- `square-wrap-footer-heights.docx`: four footer controls with exact 18-point
  versus automatic line spacing, 12- versus 9-point text, and small/tall images.
  The compatibility mode is omitted.
- `square-wrap-footer-modern.docx`: the same four controls with explicit
  compatibility mode 15. This is the only layout-setting change.

The reference application exported each document to the retained four-page PDF.
All twelve pages were visually inspected. The body controls establish text on
both sides on one baseline and exclusion continuing across paragraph boundaries.
The legacy footer controls overlap their text; mode 15 moves footer text past
the image plus its right-side distance. This distinction holds across all four
footer height/font controls. Do not generalize the legacy result to modern layout modes
or implement a missing logo by painting over unchanged text.

`tools/square_wrap_flow_reference.py` extracts each glyph's origin and baseline
directly from the PDF and independently samples green picture bounds with PDFium.
`reference.json` records these measurements and source/PDF hashes. XML
schema checks pass for all three fixtures.

The browser regression compares all twelve pages' line text, interval origins,
baseline advances and picture bounds, then checks retained export, body edits,
undo and reopen. Unit tests cover cross-paragraph exclusions, two-interval
caret/selection mapping and overlapping exclusion rectangles. Exact-line Arial
baselines retain an independently visible ~1.1pt difference from the reference application; absolute
baseline fidelity is not claimed. The corpus footer's block and inline content
controls remain a separate editable-import limitation.
