# Drag exits from empty persistent inline rich-text controls

The source is `../empty-control-home-end/control.docx`, independently authored
as OPC/XML by `tools/empty_control_navigation_fixture.py`. It contains A, an
empty persistent rich-text SDT named `letters`, and D. No editor-generated input
or third-party document engine is used.

The reference application, 2026-09-28, 100% zoom, 946x536 window:

1. Open a disposable source copy and click between A and D at (113,254).
   The control label appears. A repeated click at that position retains AD.
2. Drag from (113,254) to (220,254) for `after`, or (100,254) for `before`.
   After release, the prompt has restored as five spaces and the caret is
   collapsed outside the control.
3. Press Shift+X, then Save As a new local DOCX, maintaining compatibility mode.
   The trailing case is `A     DX`; the leading case is `XA     D`.
4. The second case was performed after undoing both typing and restoration.
   Inspect the actual saved ZIP/XML: both retain one placeholder SDT containing
   five spaces; X belongs to an ordinary run outside the SDT. Hashes and text
   are recorded in `reference.json`.

The browser tests use layout-derived coordinates, single-move and multi-move
drags, actual pointer capture, export/reopen, exact undo/redo, untouched package
parts, stationary/cancelled gestures, ordinary text selection and read-only
guards. Unchanged main fails the prompt-restoration assertion.

This native evidence establishes the completed gesture's result; it does not
record intermediate native mouse-move frames. Shift-click, same-offset edge
exits, and the previously recorded wrapping prompt's extra-D selection remain
unresolved. This is progress on corpus document #137, not a completion claim.

ECMA-376 Part 1 17.5.2.26/31 describe sdt/sdtContent and 17.5.2.25/39 describe
placeholder/showingPlcHdr. They do not prescribe mouse selection transitions;
the restored prompt and persisted package semantics follow those elements,
with the reference application's completed-drag behavior supplied by these independent controls.
