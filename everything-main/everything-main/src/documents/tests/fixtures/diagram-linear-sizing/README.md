# Native linear sizing controls

Twelve original SmartArt diagrams vary literal dimensions, frame dimensions,
width-to-height references, frame-relative widths, signed transition spacing,
and direction. The reference application initialized all twelve objects before exporting
`native.pdf`; all twelve native diagram regions were visually inspected. Saved
20x10pt drawing caches are deliberately stale. These fixtures contain no
corpus XML, third-party artwork or font binaries.

Eleven horizontal controls establish fitting without enlargement, centering,
width dependencies, negative overlap spaces, and independently clamped height.
The geometry stage resolves dimensional equality constraints on self/child
layout nodes, including named and point-type selections. Missing dimensions,
cycles, conflicting equations and unequal reference cohorts are rejected.
Non-geometric constraints and rules are returned explicitly as pending work.

The twelfth, vertical control produces different results and remains unsupported:
The reference application uses 72pt-high nodes separated by positive 12pt spaces, despite a 0.4 height
reference and -0.2 spacing factor. This observation is not yet explained or
claimed as a specification divergence. The control remains available for the
vertical algorithm work; the horizontal solver explicitly rejects it.

The solver uses exact mathematical fitting. The reference application stops slightly short: the
horizontal controls differ by less than 0.25pt in x, 0.15pt in width and 0.1pt in
y/height. These are recorded residuals, not a claim of perfect rendering. An
earlier binary-search rounding hypothesis was not established and is not
encoded. Ten preceding selection controls also pass a 0.25pt horizontal bound.

References: ECMA-376 Part 1 §21.4.2.8 (`constr`), §21.4.7.20
(constraint relationships), §21.4.7.21 (constraint types), §21.4.7.42
(linear direction), and diagram-schema constraint defaults. Layout and painting
remain separate; this module is not yet connected to editable import.

Regenerate from the repository root:

```powershell
python tools/diagram_linear_sizing_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/diagram-linear-sizing/control.docx" -OutputPdf "$PWD/tests/fixtures/diagram-linear-sizing/native.pdf"
python tools/record_diagram_linear_sizing.py
```

The native reference binds source, PDF and manifest hashes. Applied privately
to the original Science Fair Planner, the geometry stage gives widths
98.9682pt and 114.8598pt, versus native fill widths approximately 98.94pt and
114.83pt. Its non-geometric rules/constraints remain pending (43 and 37 entries).
No corpus completion or editable-import capability is claimed by this stage.
