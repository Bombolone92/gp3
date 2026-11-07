# Narrow-cell word-fit observations

Twenty independently authored OOXML tables compare fixed and AutoFit widths.
Each contains Arial bold 20pt text with kerning enabled, zero cell margins,
and preferred widths from 2850 to 2900 twips. No corpus XML or font binaries
are included. The package shell comes from the independent row-keep control.

The reference application splits OPERATIONAL at fixed widths 2850, 2860 and 2870,
but keeps it whole at 2875 and above. AutoFit expands the first three cells
to 2875 twips. Before the following-space correction, the browser measured the isolated word
at 2881.444 twips and split it at 2881 and below, including rounded AutoFit cells.
All three native/browser page pairs were inspected. Native cell widths
were queried through an owned read-only reference-application COM instance after repagination.

The independent `trailing-space-kerning` controls resolve this discrepancy:
The reference application includes the pair between the final letter and the following space when
fitting the word, while excluding the space's advance. Paragraph-end, tab,
manual-break and incompatible-font/kerning controls rule out a universal
fitting tolerance. AutoFit content minima round up to avoid emergency breaks.
All 20 native widths and line boundaries are now covered by
`tests/browser/trailing-space-kerning.spec.js`; no document-specific rule is used.

Regenerate with tools/native_fit_boundary_fixture.py, then recapture the PDF
with tools/export-reference.ps1 and the native widths before replacing
reference.json. Its hashes bind the observations to the exact source,
PDF and cases. Browser import, no-edit package preservation, edit/reopen,
unrelated-part preservation and exact undo passed on the original capture.
