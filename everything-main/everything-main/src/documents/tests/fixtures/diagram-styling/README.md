# Native SmartArt style controls

Ten independently authored diagrams exercise quick-style references, diagram
color lists, repeated color cycling, direct fill/line overrides and explicit
no-fill/no-line overrides. The reference application initialized all ten diagrams before
PDF export; all ten regions were visually inspected. The fixture uses the
project's original theme and stale drawing caches, without corpus XML or
third-party artwork.

The first eight controls establish direct formatting > diagram color lists >
quick-style reference colors. Theme line index 2 resolves to 4pt; a direct 1pt
outline overrides it. The ninth and tenth omit the layout style label, place a
differently colored decoy style before `node1`, and (in the tenth) deliberately
supply an invalid saved presentation label. The reference application still selects `node1` for the
flat text-layout nodes. The resolver implements this observed reference default;
it does not claim this applies to other algorithms or nested layouts. The
schema defaults `styleLbl` to an empty string. This is a compatibility behavior
established by native controls, not a proven contradiction of normative text.

References: ECMA-376 Part 1 §§21.4.2.28 (shape style), 21.4.3.7 (direct shape
properties), 21.4.4.8–10 (color lists/labels), 21.4.5.10 (quick-style labels),
and 21.4.7.16 (color application). The local standard/schema were consulted.

The module clones declarations and supplies them to the existing DrawingML
shape/theme parser; tests compare resulting fill/outline colors and widths to
native PDF paths. They do not claim browser pixel or placement equivalence.
Nonempty text-color lists, scene3d/sp3d/txPr declarations remain pending work;
span/cycle distributions and ambiguous presentation mappings remain guarded.
No editable SmartArt import is enabled by this stage.

Regeneration:

```powershell
python tools/diagram_styling_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/diagram-styling/control.docx" -OutputPdf "$PWD/tests/fixtures/diagram-styling/native.pdf"
python tools/record_diagram_styling.py
```

The reference binds DOCX, PDF and manifest hashes. It records PDF fill/stroke
modes as well as color and width, avoiding confusion between a filled shape and
the reference application's separate outline path. Transparent framing paths are excluded from ink
comparisons. The source Planner's thirteen arrows resolve style references;
each still reports global/local scene3d, sp3d and txPr declarations as pending.
## Additional blank/flat controls (2026-09-27)

Cases 11 and 12 add plain spaces with font/margin rules, and global/local flat
scene declarations plus empty sp3d/txPr. Their native geometry and paints are
identical to case 2. These permit validating ink-free declarations without
silently ignoring active text or 3D effects. The pending declarations remain
explicit in the standalone style resolver. Import integration is held because
of the separately discovered ordering issue documented in
`../diagram-order-normalization/README.md`.

## Recalculation integration

Flat horizontal layouts with empty or undecorated space-only text now use the
shared shape parser after model/layout recalculation. The native neutral-scene
and empty sp3d/txPr declarations are validated before being accepted. Visible
text, active 3D declarations, unsupported algorithms/adjustments and custom
point geometry retain the read-only fallback. Browser regression covers all
twelve cases through body editing, exact undo and export/reopen, preserving
the original diagram model/layout/style/color parts. The root-ordering issue
is resolved by paired nil/non-nil controls; the previous hold is superseded.
