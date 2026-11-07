# AutoFit automatic growth and page limits

These 30 original control pages derive from the manually authored
`autofit-span-pressure/legacy.docx`, with no corpus content or font binaries.
`tools/autofit_auto_growth_fixture.py` generates three ten-page packages.
The reference application exported them read-only with
`tools/export-reference.ps1`. Every generated OPC part was compared with
the exact source used for its export. `tools/record_autofit_auto_growth.py`
extracts cell-fill rectangles independently and hashes each DOCX/PDF pair.

Each table has a two-column merged cell containing an unbreakable word, an empty
spacer and a short paragraph. Their preferred widths are 150/30/120 pt. Cases
cross automatic, explicit 300 pt and 100% table widths with omitted/explicit
zero indent; then vary automatic tables' asymmetric margins and center/right
alignment. `legacy-limit` has a 300 pt writing area; `legacy-wide` has 400 pt.
`modern-wide` uses the latter cases with compatibility mode 15.

The reference application enlarges the merged span for minimum content before distributing the final
table width. Automatic tables retain the enlarged total when space permits,
while declared table widths continue to determine the target. On the wide page,
the automatic table's approximate widths are 174.65/30.024/120.02 pt; a 300 pt
declared table redistributes the remaining columns to approximately 25.1/100.3 pt.
A larger percentage target grows the merged span's preferred share as a whole.
It does not assign a new preference to each otherwise unconstrained inner column.

Legacy margin allowance depends on alignment. A left table without an indent
declaration keeps its grid at the writing edge and can extend by the trailing
cell inset. A declared indent aligns its leading text edge instead; centered
and right-aligned tables also have the full exterior inset allowance. Modern
tables use their existing outer-edge positioning. Thus the narrow legacy auto
control reaches approximately 304 pt without an indent declaration and 308 pt
with a declared zero indent. The explicit 300 pt preference stays 300 pt.

ECMA-376 Part 1 §§17.18.87, 17.4.63, 17.4.71 and 17.4.49 describe AutoFit,
preferred widths and table indentation. The compatibility-specific exterior
insets refine matching to the native reference; the general layout guidance permits alternative
algorithms. No new normative reference/spec contradiction is asserted.

Browser tests compare all 90 cell origins/widths within 0.35 pt (including native
PDF rounding), inspect page rasters and exercise editing/export/undo/reopen.
The wider-page comparison is important: matching only a page-limited table can
hide incorrect distribution when the table has room to grow. Original table
preferences remain unchanged in the package. The separate crossing-span
internal-allocation gap in `autofit-span-pressure/series.docx` remains open.
