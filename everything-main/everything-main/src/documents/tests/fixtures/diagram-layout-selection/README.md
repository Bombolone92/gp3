# SmartArt layout selection controls

Ten independently authored diagrams exercise iterator slicing and strides,
position conditions, direction variables, descendant-depth conditions, and
positive/negative/trailing transition spaces. The reference application initialized all
ten SmartArt objects before exporting `native.pdf`. All ten diagram regions were
visually inspected. Saved drawing geometry is deliberately stale; the native
reference is regenerated from data and layout definitions.

The reference application retains global sibling position inside a sliced loop: selecting nodes 2
and 3 does not make node 2 satisfy `pos = 1`. A reversed direction changes
placement, not which data node satisfies that condition. The nested-depth
control selects two root children and the deeper conditional branch. A final
sibling transition appears only when `hideLastTrans` is false.

The implementation expands the layout tree and retains constraints, rules,
shape declarations, algorithms and presentation associations. It does **not**
yet solve geometry, evaluate styles or enable editable SmartArt import. Native
bounds are recorded for the next stage; current tests compare node selection
and shape choice, not application geometry. Referenced iterators, nonpositive
steps/starts and ambiguous multi-axis attribute lists remain unsupported.

References: ECMA-376 Part 1 §§21.4.2.14 (`forEach`), 21.4.2.15 (`if`),
21.4.7.6 (axes), 21.4.7.33 (functions), and the diagram schema's
`AG_IteratorAttributes` and `CT_DataModel`. The latter permits an absent
connection list. No corpus XML or third-party artwork is included.

Regenerate from the repository root:

```powershell
python tools/diagram_layout_selection_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/diagram-layout-selection/control.docx" -OutputPdf "$PWD/tests/fixtures/diagram-layout-selection/native.pdf"
python tools/record_diagram_layout_selection.py
```

`reference.json` binds the DOCX, native PDF and case manifest by SHA-256.
The original Science Fair Planner's two layout definitions expand into seven
arrows/six spacers and six arrows/five spacers, each starting with a home-plate
shape followed by chevrons. This establishes selection only; the document
remains partial and its editable-import guard remains in place.
