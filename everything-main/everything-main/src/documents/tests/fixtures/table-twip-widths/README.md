# Whole-twip table allocations

Original raw-OOXML controls, authored without corpus XML. All use installed Arial;
no font file is bundled. Native references were captured with the reference application.

control.docx has 18 pages: fixed/AutoFit growth and reduction, half-twip choices,
and five-column equal allocations with one or two remainder twips. The last four
pages put the independently chosen text "Neat rows" at a wrapping boundary.
Fractional column geometry puts that text on the wrong line in several cells.
The reference application rounds columns to whole twips, then distributes any total-width remainder
across leading columns, one twip per column. This is not cumulative-edge rounding
or allocating the entire remainder to the first column.

percentages.docx has 12 pages: six sets of complete percentage preferences in
both fixed and AutoFit tables. The reference application normalizes these shares in whole 1/50-percent
units before resolving the explicit table width to whole twips. Normalizing only
the final floating-point widths fails these controls. Raw native COM cell widths
are retained separately from PDF-extracted line breaks; no expected geometry is
computed from the production solver.

Generate with tools/table_twip_widths_fixture.py and
tools/table_percentage_twips_fixture.py. Recapture native widths/PDFs with
tools/record_table_twip_widths.ps1, then refresh hashes and observed cell lines
with tools/record_table_twip_widths.py. The generators reuse only the minimal
package envelope from the independently authored table-row-keep-next control.

Browser tests verify all 98 cell widths and line-break lists, along with unchanged
package parts, typing/export/reopen and exact undo. Unit controls cover percentage
normalization, remainder distribution and input immutability. Existing fractional
geometry is retained for sub-twip allocations that cannot be rounded to a positive
grid; native behavior for that degenerate case is not established. Mixed-unit
rows, omitted columns and tables without an explicit width retain their existing
preference resolution. Their final positive column geometry still uses twips.
