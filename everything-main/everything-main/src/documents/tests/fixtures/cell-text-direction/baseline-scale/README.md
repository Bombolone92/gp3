# Held-out rotated font sizes and leading

`tools/rotated_baseline_scale_fixture.py` constructs 48 original paired tables:
Arial, Times New Roman, Courier New and Calibri; 8, 12 and 20 pt; automatic
line-spacing values 180, 240, 300 and 420 (0.75, 1, 1.25 and 1.75). Each table
contains six `a` glyphs in each of `btLr` and `tbRl`. Direct run and terminal
paragraph-mark font declarations match. The source is authored independently
of the viewer. No font files are redistributed.

`capture.json` records the read-only reference export. The recorder
validates all source parts, case declarations, fonts/heights, advances, text
alignment and supported EMF mapping before recording 576 baseline origins.
It binds every source/capture file by SHA-256. Some expanded text extends past
the fixed cell width; retained text records do not imply unclipped visible ink.

These cases reject a second proposed formula that appeared exact on all 216
10 pt `tbRl` origins in `frame-rounding/multiple`. It rounded the natural font
box up to a whole twip for expanded leading, then derived ascent from rounded
box height minus rounded space below the baseline. Combined with the previous
frame expression, it misses 59 of 288 held-out `tbRl` origins by 0.12 pt.
Do not select the formula by font name or size to hide these failures.
No runtime formula or tolerance was changed.

With the local viewer running, reproduce the rejected calculation with
`node tools/investigate-rotated-baseline-rounding.mjs OUTPUT_JSON`. The optional
second argument supplies a base URL; its default is `http://127.0.0.1:5173`.
The calculation is an
offline hypothesis check, not an alternative renderer or a passing-fidelity test.

Reproduce native inputs and record extraction:

```powershell
python tools/rotated_baseline_scale_fixture.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/capture-rotated-spacing-phase.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/baseline-scale/control.docx" -OutputDirectory "$PWD/tests/fixtures/cell-text-direction/baseline-scale" -ExpectedTables 48
python tools/record_rotated_baseline_scale.py
python -m unittest discover -s tests -p 'rotated*test.py'
```

Source properties: ECMA-376 Part 1 §17.3.1.33 `spacing`, §17.3.2.26
`rFonts`, §17.3.2.38 `sz`, and §17.4.72 `textDirection`. These baseline
observations do not establish a normative rounding rule or complete #338.
