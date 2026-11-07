# Paragraph between-border distance

These sixteen original DOCX cases are authored from XML by
`tools/paragraph_between_distance_fixture.py`; they contain no corpus content.
They pair body paragraphs and fixed table cells, distances 0/1/4/9 pt, zero or
18 pt before / 10 pt after spacing, and three exact-height 12 pt lines. The
bottom border has a different 9 pt distance so its behavior cannot accidentally
satisfy the between-border oracle.

The reference application exported `native.pdf` using
`tools/export-reference.ps1`. `tools/record_paragraph_between_distance.py`
records native text baselines and red divider rectangles, with source/PDF hashes.
The controls use compatibility mode 15 and installed Arial.

**Reference/spec divergence:** ECMA-376 Part 1 fifth edition §17.3.1.5 (printed
page 197) says that a between border's `space` value is ignored. The reference application instead
reserves that distance on both sides of the divider, in addition to its width
and the ordinary collapsed paragraph spacing. The divider itself is offset by
one distance after the previous paragraph's allocated after-spacing. This also
holds inside table cells. The renderer follows the recorded reference behavior while
preserving the original XML. No document-name or style-name condition is used.

The browser test compares all 48 baselines and 32 dividers, checks the complete
16-page count, and verifies no-edit parts, insertion, unrelated parts, exact undo
and editable reopen. Existing joined-border tests cover grouping changes and
page breaks. These references do not establish all border patterns, compatibility
modes, contextual-spacing combinations, or native glyph pixel identity.

Follow-up inspection includes the PDF's rectangular clipping paths when measuring
horizontal ink. The reference application clips the table dividers to the cell: their visible span is
36–336.07 pt, versus 36–336 pt in the viewer. The apparent length discrepancy is
within 0.07 pt; it does not establish a separate table-width bug. The browser test
now asserts both horizontal endpoints as well as vertical geometry for all 32
dividers, using the same 0.15 pt bound. Body endpoints are within 0.06 pt. No
renderer change or document-specific adjustment is needed. This remains a
geometry comparison, not a claim of identical glyph or border rasterization.
