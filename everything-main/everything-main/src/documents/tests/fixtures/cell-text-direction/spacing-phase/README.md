# Rotated baseline spacing and font controls

Original input constructed by `tools/rotated_spacing_phase_fixture.py` from the
original `origin-phase/control.docx`. The 36 tables contain six identical `a`
lines in each of two rotated cells, `btLr` and `tbRl`. The Cartesian product is:

- Arial, Times New Roman, Courier New, all regular 10 pt. The run and terminal
  paragraph mark use the same face. No font files are included.
- Automatic single spacing, exactly 12 pt, exactly 11.85 pt.
- Table indentation 0, 1, 2, 3 twips.

Cell geometry, row height, borders, text, margins and document settings stay
fixed. A page label identifies each case. The generator retains the original
package's other parts. The recorder compares every source part against that
construction before accepting the native references.

The reference application opened the source read-only and captured each table through
`Range.EnhMetaFileBits`. The 36 files contain 432 rotated baseline origins;
the horizontal logical unit is 0.12 pt. The recorder checks the selected face,
height, weight, rotation, italic flag, glyph advance, compatible graphics mode,
baseline alignment, logical mapping, and bounded EMF+ wrapper. These are native
GDI records, not screenshots or retrospectively captured physical font bytes.

## Finding

With automatic spacing, Arial and Times New Roman reproduce the earlier
nonmonotonic third `tbRl` baseline: logical X 1375 becomes 1374 as indentation
increases from 0 to 1 twip. Both faces produce identical X origins throughout
this sample. Their `btLr` origins remain monotonic. Courier New's automatic
spacing remains monotonic in both directions at all four tested offsets.

With either explicit spacing value, all three fonts produce identical X
origins and monotonic translations in both directions. The 11.85 pt case is
fractional on the 600-unit-per-inch grid, so fractional line advances alone
do not imply the observed backward motion.

This narrows the unresolved issue to a calculation that depends on spacing
or its resulting metrics. It does **not** prove an automatic-spacing-specific
branch: the automatic line advances are not numerically equal to both explicit
values. It does not establish a general rounding algorithm, live-screen
behavior, or font-specific correction. Do not apply a constant offset, loosen
renderer tolerances, or mark corpus #338 complete based on this experiment.

The 36-page control opens editable in the actual playground. Exact source-part
preservation, insertion, unrelated-part preservation, exact undo and reopening
pass. Source and three exports pass eight XML schema checks. Eight Python
native-reference tests cover the new and preceding phase experiments. The
existing strict height/origins browser checks retain their documented expected
failures. No application code changes.

Relevant OOXML clauses: ECMA-376 Part 1 §17.4.72 `textDirection`, §17.4.50
`tblInd`, §17.3.1.33 `spacing`. These properties describe the source; the native
sub-twip rounding is an implementation observation, not a normative rule.

## Reproduce

Run from the repository root, using the installed Python runtime and the reference application:

```powershell
python tools/rotated_spacing_phase_fixture.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/capture-rotated-spacing-phase.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/spacing-phase/control.docx" -OutputDirectory "$PWD/tests/fixtures/cell-text-direction/spacing-phase"
python tools/record_rotated_spacing_phase.py
python -m unittest discover -s tests -p 'rotated*test.py'
```

Review regenerated references before replacing them. Native files contain
original text and drawing records, with font family names but no font binaries.
