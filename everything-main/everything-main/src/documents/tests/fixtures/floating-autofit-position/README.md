# Floating AutoFit position controls

Six original OOXML controls, authored by tools/floating_autofit_position_fixture.py
using Arial 10pt, exact 12pt lines and compatibility mode 15. Three top-level and
three nested AutoFit tables use automatic table width and 36pt/132pt cell width
preferences. Horizontal offsets are 0, 216 and 360pt. No corpus content is used.

The reference application retains the column widths at all offsets. Nested placement clamps
to the parent cell; top-level placement may extend beyond the page. Position is
not an inline indent that reduces the AutoFit width limit. This separates ECMA-376
Part 1 17.4.57 positioning from the AutoFit sizing described by 17.18.87 and cell
width preferences in 17.4.71. There is no source-specific rule.

The reference generator extracts 18 PDF text origins and full-page previews;
the manifest binds the exact source, the native reference PDF and origins. All six native views
were inspected. Browser and unit tests compare origins within 0.15pt and retain
single-line labels. Browser coverage includes growing the last row, hit testing,
no-edit retention, edited export/reopen, unrelated parts and exact undo. The
reference does not certify every AutoFit layout or pixel-identical rendering.
