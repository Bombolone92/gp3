# Physical/PDF projection holdouts

This numeric reference uses the existing independently authored controls in
print-paper-height-phase, print-paper-phase, print-border-phase, print-row-phase
and print-tie-phase. It binds each source, case list, raw reference and font-free
geometry PDF by hash. No new source document, original corpus artwork, font
program or native metafile is copied here.

All 1008 blue fill rectangles were compared, preserving their native order.
Two proposed conversions are deliberately rejected:

- Project horizontal pen centerlines and vertical-body endpoints from the
  inclusive 600dpi page grid to the 3000dpi PDF grid, retaining physical pens.
  This misses 154 rectangles at the recorded 0.000021pt tolerance.
- Project each table's leading pen centerline and apply that translation to its
  whole frame, retaining every raw extent. This misses fourteen rectangles.

The two recorded counterexamples have identical raw heights of 159 reference
units, or 19.08pt. The native PDF heights are respectively 19.08 and 19.104pt.
The first rule fails the former; the second fails the latter. Choosing a rule
based on the fixture, origin or page size is not justified by these observations.

`tools/test_print_projection_holdouts.py` extracts the actual blue PDF rectangle
operands with pypdf, checks hashes and clip/transform assumptions, recomputes all
counts, and validates the two counterexamples. It reads geometry only and never
inspects or copies font programs. The rules are hypotheses in test code; they
are not used by the viewer.

A fresh read-only native capture after PDF export reproduced all eight original
print-tie-phase metafile hashes. The exact owned source remained visible, Saved
and unchanged. `afterPdfCapture` records only those hashes and guards; private
native files stay outside the repository. This rules out a changed capture
between these observations, but does not establish identical internal layout
passes or a universal conversion between metafile and PDF coordinates.
