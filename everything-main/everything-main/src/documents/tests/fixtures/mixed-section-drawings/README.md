# Drawings in sections adjacent to column flow

`tools/mixed_section_drawings_fixture.py` independently authors three sections:
a single-column page with a red positioned rectangle, a two-column page with
an explicit column break, and a single-column page with a blue rectangle.
The drawings use page-relative coordinates and no text wrapping. No corpus
content or third-party document engine is included.

The reference application exports three pages (`control.pdf`). Each rectangle
occupies (72,144)–(144,180) points on its own page. At 96 DPI the native and
browser solid-color bounds are both x=96–191, y=192–239. All three full-page
comparisons were inspected. Text coordinates and source/PDF hashes are in
`control-reference.json`, recorded with `tools.record_column_flow.record`
using this directory and an expected line count of four.

The former document-wide positioned-drawing guard rejects this source merely
because its middle section has columns. The section-scoped guard permits it
without permitting positioned drawings inside column flow itself. A negative
unit case moves an anchor into the middle section and verifies the guard.
The browser test checks native text geometry, drawing frames on pages one and
three, editing, unrelated OPC parts, exact undo and reopening.

ECMA-376 Part 1 §§17.6.3–17.6.4 define section column sets; §20.4.2.3 defines
anchored drawings. This fixes guard ownership, not a reference/spec divergence or
general support for floating objects inside multi-column sections.
