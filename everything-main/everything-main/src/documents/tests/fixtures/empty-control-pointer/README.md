# Native pointer exits from empty rich-text controls

Original inputs are `../empty-control-home-end/control.docx` and `wrapped.docx`,
authored directly as OPC/XML by `tools/empty_control_home_end_fixture.py`.
They contain A, an empty persistent inline rich-text SDT, and D. The wrapping
source declares a bold 40-word glossary placeholder. No editor-generated input
or third-party document engine was used.

Reference application UI captures on 2026-09-28, at 100% zoom:

1. Open a disposable source copy. In the observed 946x536 reference application window, click
   between A and D at (113,254). The `letters` control label appears.
2. Click (100,254) for `before`, (220,254) for `after`, or (700,440) for
   `wrapped-below`. The empty control restores its prompt.
3. Type X with a keypress. Save and inspect the actual ZIP/XML before recording
   the result. `before` is XA + five spaces + D; `after` is A + five spaces + DX;
   `wrapped-below` is A + the glossary text + DX. X is outside the SDT.
4. Undo X and restoration to return to the empty state when repeating a case.

The short controls were finally saved with Save As, retaining compatibility
mode, because early Ctrl+S attempts had left the on-disk input unchanged.
Those unchanged copies were rejected as evidence. The committed files have
verified final text/control contents and hashes in `reference.json`.

The browser cases use actual mouse events and layout-derived coordinates at
two zoom levels, not the reference application's screen coordinates. They verify entry ownership,
repeated entry, restoration, typed-marker ownership, no-edit parts, preserved
unrelated parts after editing, exact undo, redo and exported-file reopening.

## Unresolved first-line wrapping behavior

Clicking (220,254) while exiting the empty *wrapping* control selects the restored
prompt **and D** in the reference application. Typing X yields AX and removes the SDT, as retained in
`native-wrapped-first-line.docx`. The selection was reproduced a second time.
An ordinary click at the same position after restoration selects only the
prompt. The cause and general boundary rule remain unresolved; the viewer's
ordinary placeholder hit test does not reproduce this extra-D selection.
This is retained evidence of an incomplete interaction, not a passing case.
Shift-click, dragging out, and same-offset leading/trailing pointer exits also
remain outside the verified subset. Corpus document #137 remains partial.
