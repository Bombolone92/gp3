# Numeric page-field pictures

`tools/numeric_page_fields_fixture.py` manually authors this original five-page
DOCX. The reference application exports `native.pdf` without saving the source.
`tools/reviewed_font_reference.py numeric-page-fields` extracts independently
measured text, glyph origins, baselines and source/PDF hashes.

Each section restarts numbering (0, 1, 12, 1234, then upper-Roman 12). The
footer mixes simple and complex PAGE fields, NUMPAGES and SECTIONPAGES, stale
99 caches, quoted and unquoted pictures, and both MERGEFORMAT switch orders.
Seventeen pictures cover required zeros, optional spaces, grouping, integer
truncation, decimal placeholders, signs, literals, percent suffixes and
positive/negative/zero sections. Negative values cannot result from these page
fields, so the negative section is parsed and retained but never selected.

ECMA-376 Part 1 §17.16.4.2 specifies numeric pictures. This control confirms
that `#` pads with spaces, not omitted characters: page zero with `0#` is
`0 `, page one is `01`. Numeric pictures take precedence over the section's
Roman numbering. `%` is a literal suffix, not multiplication by 100.

The reference application details not fully described by that clause are recorded explicitly:
`##0.##` gives `  0.0 ` for zero, but `  1.  ` for one; `0.0x` gives `1.0`
without a trailing blank. An initial integer x truncates high digits, whereas
an x following another placeholder does not (`x##` yields 234 for 1234,
`0x0` yields 1234). The clause's unrestricted description of dropping digits
left of x would suggest otherwise for the latter. The original control proves
the implemented reference behavior; no corpus-specific formatting rule is used.

PDF text extraction collapses repeated spaces. The browser oracle checks the
closing bracket's independently measured origin as well as every line's text,
baseline and initial origin, so whitespace widths cannot pass by collapsing
them. Tests also check exact spaces, native body editing, unchanged package
parts, undo and reopening. SEQ-dependent backtick references and malformed
pictures remain unsupported rather than being silently dropped. Decimal and
grouping output use the browser locale; this native reference uses US English.

All five reference and browser pages were visually inspected. Validation passes:
75 unit tests, 13 browser cases (including the corrected new oracle rerun),
192 source/export XML checks, production build and license gate. The actual
invoice now opens for editing and passes package preservation, edit, undo and
reopen checks; its separately recorded table/typography gaps remain open.
