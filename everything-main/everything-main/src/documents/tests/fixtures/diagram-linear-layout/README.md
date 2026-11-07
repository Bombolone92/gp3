# Native linear SmartArt traversal controls

This original eleven-page DOCX varies child count (2/3/5), linear direction
(fromL/fromR/fromT/fromB), and the XML ordering of data points, connections and
presentation points. Each node has a distinct direct fill. Every saved drawing
deliberately contains tiny, overlapping 20x10pt rectangles. The reference application
initializes all eleven SmartArt objects before export and regenerates 34 large
rectangles from their models/layouts. All eleven native regions were inspected.

Later paired-root controls identify the trigger: these fixtures use a nil-GUID
document root, which the reference application replaces while renumbering children. Normal non-nil
roots retain declared srcOrd ordering. See `../diagram-order-normalization/README.md`.

Cases 7–11 separate storage order. The reference application follows data-point order in these
controls; reversing connection or presentation-point order alone does not
reverse the output. The connections retain ascending `srcOrd` values. This is
an measured reference behavior, not proof of a universal ordering rule
or a claimed contradiction of the standard. The graph reader retains both
declared ordinals and source XML. No source identifier or layout name controls
its behavior.

The graph reader now feeds the supported blank-text horizontal recalculation
path. The following describes the original graph-only checkpoint. It separates data and presentation points, checks parent
and transition identities, and rejects ambiguous, disconnected or cyclic data
trees. It does not evaluate layout axes, conditions, constraints, spacing,
algorithms, text or styling. The existing read-only cached-drawing preview and
editable-import guard remain unchanged. This fixture is not a passing native
geometry test for a layout engine: the unit check compares traversal order to
native colored shapes, not application shape bounds.

References: ECMA-376 Part 1 §§21.4.3.2 (`cxn`), 21.4.3.5 (`pt`), 21.4.2.14
(`forEach`), 21.4.7.6 (`ST_AxisType`) and 21.4.7.42 (`ST_LinearDirection`).
The local specification was consulted. The layout and graph were authored
independently; no corpus SmartArt XML, artwork or font binaries are included.

Regeneration, from the repository root:

```powershell
python tools/diagram_linear_layout_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/diagram-linear-layout/control.docx" -OutputPdf "$PWD/tests/fixtures/diagram-linear-layout/native.pdf"
python tools/record_diagram_linear_layout.py
```

The reference binds source, PDF and case manifest with SHA-256. All 59 source
XML checks pass. New graph and existing preview unit suites pass 34 checks;
the existing diagram-preview browser preservation test, production build and
200-package license gate pass. A 12,000-node synthetic graph checks traversal
without recursive call-stack dependence. XML parsing is independently exercised
by all eleven original DOCX models. An initial deep test unnecessarily wrapped
the synthetic graph in a large live JSDOM collection; that test run was stopped
and replaced with a direct graph test.

The original Science Fair Planner's models parse as 31 points/24 connections
with six root children, and 36 points/28 connections with seven root children.
Its editable import remains unsupported. Next work is layout-tree traversal
and constraint evaluation, followed by native placement/style comparisons and
the original source's editing/export checks.
