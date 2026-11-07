# Signed header clearance

These original controls isolate the report's vertical-position error. They do
not contain corpus content. `tools/header_clearance_probe.py` authors the DOCX
parts using the existing original chart fixture solely as an OPC shell.
The reference application opened every source read-only and exported its PDF
without saving the DOCX. `record_header_clearance.py` extracts the green table
border centerlines and records source/PDF hashes.

The four `spacer-*` controls compare 4/16-point empty paragraphs at the document
start and after an authored page break. The reference application's table top is 41.40 points for
the 4-point spacer and 56.04 for the 16-point spacer, unchanged by the break.
The four `header-spacer-*` controls add empty 4/16-point headers, with both
header distance and absolute top margin set to 36 points. Positive margins
move the table top to 46.20/60.84 points. Negative margins allow header overlap
and leave it at 41.40 points. This agrees with ECMA-376 Part 1 §17.6.11 `pgMar`:
nonnegative margins account for the selected header/footer extent; negative
margins are fixed relative to the page edge.

The original renderer placed all four header controls at 41.3828125 points.
`tests/browser/header-clearance.spec.js` now compares all eight controls with
these native references (0.2-point tolerance for table border centerlines), checks
their source/PDF hashes, and exercises editing, unrelated-part preservation,
exact undo and reopening. The controls pass with selected-story body clearance.

Additional unit coverage in `tests/story-clearance.test.js` checks first/even/
default selection, signed top/bottom margins, repeated tables in modes 14/15,
widows across differently sized writing areas, NUMPAGES/SECTIONPAGES wrapping,
caret geometry, and unchanged oversized/merged rows when stories are empty.
Existing section-numbering tests exercise restarts, parity and inserted pages.
These synthetic measurement tests supplement the eight native reference controls;
they are not additional reference comparisons.
