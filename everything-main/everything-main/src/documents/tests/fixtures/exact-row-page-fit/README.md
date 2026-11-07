# Exact row page-fit controls

Original OOXML authored by `tools/exact_row_page_fit_fixture.py`, using the
project's own empty-table package scaffold. Eight tables each contain 37 rows,
three columns, independently labelled text, and an explicit pale-blue fill.
There is no corpus content, renderer-derived expected value or embedded font
program in the DOCX. Installed Arial is requested by family name.

On 2026-10-04 the reference opener opened the authored source in the reference application.
Native Save As PDF used Standard quality with Open after publishing unchecked.
The same-named PDF was renamed locally to `native.pdf`; only the owned reference
source window was closed. The source remains byte-identical to a fresh
deterministic generator run (SHA-256
`b704bdcf5f96f727020a0ff9cf948e75440309c22935fcaf11633aad08053d0e`).
No reference-saved DOCX was captured.

`tools/record_exact_row_page_fit.py` reads PDFium label positions, not font
programs, and binds all 296 row labels to source/case/PDF hashes. There are 16
native pages. Every table occupies two pages:

| Case | First page rows | Second page rows |
| --- | ---: | ---: |
| 400 twips, no borders | 36 | 1 |
| 400 twips, 2pt top borders | 36 | 1 |
| 399 twips, 2pt top borders | 36 | 1 |
| 401 twips, 2pt top borders | 35 | 2 |
| 402 twips, 2pt top borders | 35 | 2 |
| 400 twips, 4pt top borders | 36 | 1 |
| 400 twips, 2pt bottom borders | 35 | 2 |
| 400 twips, 2pt top and bottom borders | 35 | 2 |

The writing area is 720pt high. Top/bottom borders occur only in the third
column, proving that a shared winning edge in another column still affects
logical centerlines. A next row's top border must not add its exterior half
to the preceding exact row's page-fit demand. Own bottom borders remain real
constraints. This is a fit distinction, not a height rewrite or an overflow
tolerance; one extra twip still moves the 36th row.

ECMA-376 Part 1 §17.4.80 specifies exact row heights. The published
[MS-OI29500 §2.1.180](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/5919e0bd-e6ce-477e-8d66-0e5282f5c506)
note documents additional bottom padding; that earlier behavior is retained.
The independent controls establish the shared-border page-fit behavior without
claiming the standard specifies the reference application's border centerline arithmetic.

The native unit regression checks every row's page, not just page totals. The
browser regression checks the last fill row and following whitespace on every
page through edits, undo and export/reopen, with exact untouched package parts.
Fine glyph rasterization and all other corpus fidelity remain separate work.
