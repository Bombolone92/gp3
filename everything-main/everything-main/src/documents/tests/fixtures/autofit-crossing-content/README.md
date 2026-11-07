# Crossing-span content and page-limit controls

Original OOXML is assembled by `tools/autofit_crossing_content_fixture.py`.
The deterministic packages contain sixteen cases each, with no corpus content
or bundled font. Arial is referenced. Both use compatibility mode 15.
`control.docx` allows 300pt of writing width; `wide.docx` allows 420pt.

The four-column table has consistent explicit cell preferences: 150/30/120pt
in the upper row, with the first cell spanning two columns, and 80/220pt in
the lower row, with the second cell spanning three columns. The upper cell
contains twenty M characters. Cases vary the lower text length, reverse the
two rows, or change cell margins. `cases.json` records the exact parameters.

The reference application opened each exact source read-only and exported sixteen
pages through `tools/export-reference.ps1`. The independent recorder
`tools/record_autofit_crossing_content.py` reads the widest PDF fill rectangle
for each of five cell colors and binds source, PDF and case hashes. Run the
recorder with no argument for `control.docx`, or `wide` for the wider source.

Reversing the rows leaves native widths unchanged. Increasing the lower text
from ten to twelve M characters reduces the lower-left width from about
126.14pt to 108.02pt. That transition also occurs on wide pages, ruling out
page clipping as its cause. Wide pages preserve the outside 30/120pt columns;
the narrow pages subsequently reduce those columns. The lower-left width is
preserved within native PDF coordinate precision between the two page widths.

These observations isolate internal minimum allocation from final page-width
reduction. For a fully determined explicit preference system displaced by
content, the engine weights a growing span by each column's preference plus
its measured content minimum. Empty-cell writing floors are excluded from
that measurement. Remaining span minima are retained before final reduction.
Feasible preferences keep the prior path. No XML width is rewritten.

The browser oracle requires all narrow- and wide-page cell origins and widths
to match within 0.2pt. The September 27 protected-minimum correction removed
the earlier pending-failure annotations. Import, reference hashes,
page/cell counts and finite geometry are checked normally.
Missing Arial explicitly skips native comparisons. Separate full UI
reviews cover preservation, insertion, undo and export/reopen on both sources.

ECMA-376 Part 1 §17.18.87 permits alternative AutoFit algorithms; §§17.4.17,
17.4.63 and 17.4.71 define spans and preferred widths. These controls establish
observed reference compatibility, not a demonstrated normative specification
contradiction or complete coverage of all overlapping-span combinations.

## Direct cell-width audit, September 27, 2026

`control-cell-widths.json` and `wide-cell-widths.json` record the reference application's `Cell.Width`
after repagination, independently of PDF painting. Each binds its exact source
SHA-256 and the reference application version/build. Reproduce with `tools/record-native-cell-widths.ps1`
using `-SourceFullPath` and `-OutputJson`. The tool opens the exact source
read-only, verifies it, closes its own document/application, and verifies the
source hash again before writing results. These controls contain no nested
tables or vertical merges; this audit does not certify those configurations.

At the September 27 audit, the app differed from direct widths by up to 0.25pt on the narrow
source and 0.15pt on the wide source. For example, narrow case 16's right cell
is 89.10pt in the app, 89.35pt through the reference application's cell API, and approximately
89.45pt in the PDF fill reference. Thus PDF fill bounds account for part, but
not all, of the residual. Wide case 16's lower-left width is already 0.15pt
too large before page-edge reduction. A correction limited to reducing outside
columns would not address that discrepancy.

The browser probe now records direct-width differences alongside the unchanged
PDF comparisons, at the same 0.2pt threshold. Narrow cases initially remained
expected failures; the wide case passed. Neither tolerance nor renderer changed
in that measurement-only audit.

## Current verification, October 1, 2026

After the protected-minimum correction (`09135cda`), both sixteen-page sources
pass every PDF boundary and direct reference cell-width comparison on `d08e6d7b`,
without changing the native references or 0.2pt tolerances. The fresh
`native-boundary-differences.json` artifacts contain empty `differences` and
`cellWidthDifferences` arrays. The older residuals above describe the earlier
engine, not a current known failure. This is bounded compatibility evidence,
not universal AutoFit equivalence; see `../autofit-span-floor` for the related
independent controls and their remaining one-twip allocation allowance.
