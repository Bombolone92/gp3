# Native font size emission and advance holdouts

`tools/font_size_emission_fixture.py --output-folder FRESH` manually authors
48 rows: Arial, Calibri and Times New Roman; regular/bold; 9–12.5pt in half-point
steps. Every row uses the same neutral Latin text, disabled kerning and zero
character spacing. Compatibility mode is 15. The legal-size page has exact
17pt line spacing. No font programs or corpus text are included. Regeneration
produces the recorded source SHA-256 exactly:
`c7b5342a5a88ffe6fa63b68518a92ba998a04fb907315bb4628e53f6817a0e93`.

Relevant ECMA-376 Part 1 clauses: §17.3.2.38 `sz` specifies half-point sizes;
§17.3.2.19 `kern` and §17.3.2.35 `spacing` specify the two deliberately disabled
advance features. The native emitted sizes below are observations of the reference application's
device/output paths, not a reinterpretation of the source half-point values.

The exact control was opened with the reference-opening helper, then captured from the
already-open reference application document. Capture guards preserve source, Saved state,
view and zoom. Raw page metafiles and PDF remain private and hash-bound in the
aggregate. The PDF reader strips FontFile/FontFile2/FontFile3 before constructing
metadata fonts. Its optional font metadata exposes text-state declarations;
it does not read glyph programs or measure glyph ink.

All six font/weight combinations produce these sizes on both native paths:

| Authored pt | PDF declared pt / page font height pt |
| --- | --- |
| 9 | 9 |
| 9.5 | 9.48 |
| 10 | 9.96 |
| 10.5 | 10.56 |
| 11 | 11.04 |
| 11.5 | 11.52 |
| 12 | 12 |
| 12.5 | 12.48 |

These 48 observations match rounding to a 0.12pt grid (600 units per inch).
The page-metafile window extent is 5100×8400 for a 612×1008pt page. This bounded
result does not establish every reference application device profile or font/script behavior.

All 48 actual Canvas paint calls reconstruct exactly from isolated character
paints in this Latin scope. All 720 non-whitespace native identities agree.
Maximum current origin differences are 0.187122pt against native PDF metadata
and 0.185157pt against native page records. Instrumentation changes zero RGBA
bytes on the complete page.

An isolated measurement probe keeps each actual font family, weight, kerning,
tracking, transform and first origin, but measures at the observed quantized
size. It worsens 333 PDF origins and 299 page origins; maximum differences rise
to 0.676428pt / 0.612108pt. It neither mutates the document nor changes its
paint. Thus native output font size alone cannot justify globally quantizing
layout measurement. The renderer is unchanged.

This rules out a simple global font-size correction for the current cover-letter
investigation. It does not explain all kerning/tracking cases in the separate
Calibri sixteen-case control, prove glyph-ink equivalence, or certify originals.
Remaining work must distinguish glyph size, character advances, shaping and
device projection using further native evidence. No corpus document is promoted.

Validation: nine metadata-reader tests (including forbidden fake embedded-font
streams, fractional size/scaling and unchanged default output), byte-exact source
regeneration, source document/settings schema views, and 48 guarded actual-paint
reconstructions. [Native observations and isolated probe](native-page-pdf-origins.json).
