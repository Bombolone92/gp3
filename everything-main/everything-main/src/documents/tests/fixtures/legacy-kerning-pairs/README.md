# Legacy and OpenType pair positioning: unresolved

The original OOXML generator creates 56 right-aligned 12pt lines in four fonts:
Palatino Linotype, Constantia, Arial and Goudy Old Style. Fourteen strings per
font isolate letter pairs, internal spaces and longer combinations. Both
two-page controls explicitly request no optional ligatures and 1pt minimum
kerning; only the `enableOpenTypeFeatures` document switch differs. No corpus
content or font binaries are embedded or distributed.

The reference application exported both controls read-only. Source/PDF hashes,
page numbers, extracted text, font names and line origins are retained in
`reference.json`. The generator reproduces the source bytes exactly.
Run `tools/legacy_kerning_pairs_fixture.py`, export each control through
`tools/export-reference.ps1`, then run
`tools/record_legacy_kerning_pairs.py` to regenerate the native observations.

Current browser rendering matches all 56 enabled lines. With OpenType disabled,
four Palatino lines fail the unchanged 0.2pt position bound: `To` (0.9243pt),
`R x` (0.3890pt), `AVATARToWa` (0.8884pt), and `AVATAR To Wa` (1.2484pt).
The other 52 disabled lines pass. A separate expected failure preserves those
four discrepancies; the passing test excludes only those exact independent
control indices. Both controls retain editable package/export/undo coverage.

Private diagnostic measurements identify why removing all GPOS data is unsafe:
Palatino's long spaced sample improves but still misses native placement, while
Constantia loses all pair adjustment. The installed Palatino legacy table
includes an R/space pair of -45 design units. Constantia has 36,740 pairs: its
format-0 subtable requires 220,454 bytes, while the 16-bit length field contains
23,846 (the low 16 bits). The lost browser kerning after GPOS removal is observed;
attributing it specifically to sanitizer handling of that overflow remains an
inference. The reference application's width agrees with summing its actual legacy pairs.

A private prototype converts legacy format-0 pairs into GPOS PairPos/extension
lookups. All 56 disabled native line widths then agree within 0.158pt. It is
**not a production fix**: replacing the complete GPOS table discards mark and
other positioning features. A safe implementation must replace only the kern
feature's lookup references, preserve unrelated script/language features and
fallback shaping, and retain the document's enabled/disabled distinction even
when both modes request no ligatures. Existing spacing, style and synthetic
advance behavior also needs regression coverage. No renderer code changed here.

References: ECMA-376 §17.3.2.19 (`kern`), MS-DOCX `enableOpenTypeFeatures`, and
the OpenType [kern](https://learn.microsoft.com/en-us/typography/opentype/spec/kern)
and [GPOS](https://learn.microsoft.com/en-us/typography/opentype/spec/gpos)
tables. These observations establish native compatibility differences, not a
demonstrated contradiction of a DOCX clause.
