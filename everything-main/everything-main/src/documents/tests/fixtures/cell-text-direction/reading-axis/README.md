# Rotated reading-axis placement

Original four-page control for the remaining corpus document #338 discrepancy.
Each table contains three centered Arial 8pt labels in two bottom-to-top
columns and one top-to-bottom column. Exact row heights are 45.6, 50.45 and
43.5pt, with 0.25pt top/bottom margins and automatic paragraph spacing.
Pages 1/2 pair an ordinary table with a nested table in a zero-margin parent;
pages 3/4 repeat the pair 178pt lower. No corpus package parts are included.

The reference application produces identical text matrices for each ordinary/nested
pair. The browser also produces identical positions for each pair. Across
all 36 origins, maximum native/browser differences are 0.035704pt across
the reading axis and 0.151577pt along it. Existing comparison thresholds
remain 0.15pt X / 0.2pt Y; these figures are not pixel-exact conformance.

Opposite rotations expose position-dependent PDF coordinates: the implied
advance of `Very well` changes from 32.40pt to 32.28pt after translation;
`Somewhat` changes from 38.04pt to 37.92pt. The authored text, font, size,
alignment and table dimensions do not change. Browser advances remain
32.453096pt and 37.796847pt. Thus a constant width correction cannot explain
the complete result. These are PDF-export observations; they do not establish
the exact native rounding algorithm or reference application UI pixel placement.

Relevant OOXML properties are ECMA-376 Part 1 §17.4.72 (`textDirection`),
§17.4.81 (`trHeight`), §17.4.42 (`tcMar`), §17.3.1.13 (`jc`) and
§17.3.1.33 (`spacing`). No new rendering behavior is introduced.
Corpus document #338 still has 15 pages and unchanged rotated origins, including
the previously measured 0.213862pt maximum reading-axis discrepancy.

Reproduce from the repository root:

```powershell
python tools/cell_text_direction_reading_axis_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/reading-axis/control.docx" -OutputPdf "$PWD/tests/fixtures/cell-text-direction/reading-axis/native.pdf"
python tools/record_cell_reading_axis.py
npx playwright test tests/browser/cell-text-direction-reading-axis.spec.js
```

The JSON binds source and native PDF hashes. The browser test checks all
36 origins, text/order, the nesting invariant and the native translation
observation. The control opens on four editable pages and passes no-edit package equality,
insertion, unrelated-part preservation, exact undo and edited reopening.
Source and three exports pass all 12 XML schema checks.
