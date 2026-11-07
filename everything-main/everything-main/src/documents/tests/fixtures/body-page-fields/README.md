# Body page-field controls

Original OPC/XML from `tools/body_page_fields_fixture.py`, with no corpus or
third-party document content. Fifteen PAGE, NUMPAGES and SECTIONPAGES fields span
ordinary paragraphs and table cells, complex/simple syntax, a locked result,
MERGEFORMAT, explicit Roman/numeric formatting, and two sections across three
pages. The second section restarts at VII. Every unlocked cache is deliberately
99; the locked cache is 88. Complex instruction runs are italic 11 pt and cached
results are bold 14 pt so formatting regeneration is distinguishable.

`tools/record_body_page_fields.ps1` opens a verified disposable writable copy
in its own reference application instance. It records results immediately on opening,
after Repaginate, and after Fields.Update plus Repaginate. `native-results.json`
identifies the reference application and the source SHA-256, includes field-result WordOpenXML
body fragments, and records three pages and update return code zero.

Observed native behavior:

- Opening and repagination preserve every stale body/table cache.
- Explicit updating generates 1/2/VII page numbers, document total 3, section
  totals 2/1, II for the explicit Roman field and 0007 for the numeric picture.
- The locked PAGE remains 88 with its cached formatting.
- MERGEFORMAT retains bold 14 pt. An unlocked complex field without it uses
  italic 11 pt instruction formatting. A simple field without it returns to
  paragraph defaults.

The source passes all three transitional schema checks. The initial authoring
version put pageBreakBefore after spacing; that ordering was corrected before
regenerating this source and recording these native results. The optional
`-ExportPdf` step stalled after behavior recording and was interrupted. No native
PDF or visual comparison is claimed. Default behavior-only recording completes.

Body cached-result editing and delimiter-preserving export are now implemented,
including empty and multi-paragraph ranges. Explicit field updates and a native
visual comparison of this independent fixture remain to be done.
The existing page-field parser/evaluator matches all fifteen explicit native
values in `tests/body-page-fields-native.test.js`. It must not be wired into body
layout as an unconditional automatic refresh based only on these tests.

## Result editing and envelope serialization

`tools/record_body_field_edits.ps1` records five independent range edits against
the first PAGE result. `native-edits.json` retains the source hash, exact body XML,
field count, instruction and result. Insertion produces 9X9; replacement produces
Edited; deletion leaves an empty result; paragraph splitting produces 9\r9;
italic formatting leaves 99. All operations retain all fifteen fields without
error. The reference application's automation API reports null Result.Text for the empty range. These are range
operations, not a claim that every UI selection behaves identically.

`writePageFieldResult` now provides same-paragraph result serialization while
retaining simple/complex envelopes, instructions, switches, delimiter properties
and flags. An initially uncached complex field receives a separator when a
result is written. Unit and browser tests cover result replacement and retained
envelopes; exported controls pass schema validation. Body import/editing now uses
zero-width start/end markers, retaining empty and cross-paragraph results.
Same-paragraph simple fields retain their wrapper; splitting them converts the
envelope to complex field syntax. Native range-edit XML is independently imported
in tests. Browser tests exercise deletion, refill, split/join, export/reopen and
simple-field conversion. Explicit refresh remains pending; cached results are
not automatically evaluated during opening or repagination.
