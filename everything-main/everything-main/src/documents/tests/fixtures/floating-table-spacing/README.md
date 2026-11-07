# Paragraph spacing below floating tables

Hand-authored independent OPC/XML from `tools/floating_table_spacing_fixture.py`.
No corpus content or third-party artwork. The first thirty-six pages vary a blank/text
anchor paragraph, 0/3 pt table borders, 0/2/6 pt paragraph space-before and
0/4/10 pt space-after on the preceding paragraph. Arial 10 pt with exact 12 pt
lines isolates paragraph spacing from font-dependent automatic line heights.

The reference application exported `native.pdf` using
`tools/export-reference.ps1`. `tools/record_floating_table_spacing.py`
captures all 182 baseline origins and source/PDF/case hashes. The reference application retains the
anchor paragraph's full before-spacing after text clears the full-width table,
independently of the preceding paragraph's after-spacing and table border width.
The original layout swallowed that spacing during square-wrap clearance.

ECMA-376 Part 1 §§17.3.1.33 (`spacing`) and 17.4.57 (`tblpPr`) describe paragraph
spacing and floating-table placement. The exact interaction at clearance is
documented measured reference behavior, not a claimed normative contradiction.
Separate regressions retain existing behavior beside tables, on continuation
lines and around pictures; the controls cover text-, page- and margin-anchored tables in compatibility mode 15.

Fourteen further pages exercise page/margin anchoring, text beside a narrow
floating table, and the upper-edge boundary with zero and 3 pt borders. The reference application
moves a line ending exactly at the table top below it; a one-twip separation
leaves the line above. The preceding main-branch implementation already missed
that boundary, producing up to 87 pt of displacement in these minimal controls.
The corrected layout matches all 182 recorded baselines within 0.11 pt. Both
rules are shared table-wrapping behavior, with no source-template special cases.

Nested floating tables keep strict top-edge overlap. Their separately retained eighteen-page native controls caught and prevent applying the body-table boundary rule inside a parent cell.
