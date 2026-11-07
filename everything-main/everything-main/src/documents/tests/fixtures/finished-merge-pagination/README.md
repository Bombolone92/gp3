# Completed merged-cell pagination

Original OPC/XML is authored by `tools/finished_merge_pagination_fixture.py`.
The reference application exported the four PDFs read-only. The independent
recorder `record_finished_merge_pagination.py` captures native page assignments,
text origins and SHA-256 hashes. No source template content or fonts are included.

A two-row table follows a tall paragraph. The second row's 120pt minimum forces
it onto a fresh page. The center cell spans both rows. Controls cover an empty
owner, one already-finished line, 26 continuing lines, and no footer. All four
documents have two pages in the reference application. All eight native/app page pairs were inspected.
Browser assertions check the native page and X/Y text origins within 0.3pt,
including all 26 continued lines, and repeat editing, exact undo, export/reopen.
Unit tests also check caret hit testing and unrelated-package preservation.

Before the correction, `empty-footer` renders three pages in the app. The
page-dependent flow-height calculation counted a backward interval as positive:
an owner ending on page zero falsely demanded space from a row starting on page
one. A finished owner now has zero remaining demand. Actual continuing owners
retain the existing forward-flow calculation, row height and clipping rules.
No extra measurement or layout pass is introduced.

Relevant ECMA-376 Part 1 clauses: 17.4.84 (`vMerge`), 17.4.80 (`trHeight`),
17.4.6 (`cantSplit`), and 17.18.37 (`ST_HeightRule`). This is an implementation
arithmetic defect, not a newly observed reference/spec divergence. Native PDF and
Canvas border antialiasing still differ; this regression verifies pagination
and text geometry, not pixel-identical rasterization.
