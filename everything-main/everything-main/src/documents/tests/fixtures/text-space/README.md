# WordprocessingML text whitespace

`tools/text_space_fixture.py` generates the seven conforming controls in
`source.docx`. They distinguish absent/default/direct-preserve `xml:space`,
space-only text, internal spaces, and tab/newline edge whitespace. The reference application opened the exact source read-only and exported `native.pdf`.
The reference JSON retains source/PDF hashes and extracted native text.

The reference application trims XML edge whitespace when `w:t` does not explicitly request
preservation. Internal spaces and nonbreaking spaces remain significant.
ECMA-376 Part 1 §17.3.3.31 (printed pages 355–356) references XML 1.0 §2.10
space preservation. The default processing policy is application-dependent;
this control establishes the reference application's policy rather than a normative contradiction.

`--nonconforming` generates the separately named nine-case probe. Its additional
`xml:space` attributes on `w:r` and `w:p` are rejected by the OOXML schema.
The reference application nevertheless loads the file, ignores these ancestor declarations and
trims the child text. Its retained PDF/reference document this compatibility
case, not a schema-conforming inheritance rule. Do not include that negative
package in a claimed all-valid source set.

Tests retain the original no-edit bytes, compare native import and read-only
projection, and check significant spaces through editing, export/reopen and
undo. The DrawingML hyperlink control independently checks the resulting
picture placement after an unmarked trailing space.
