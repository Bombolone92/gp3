# Filled rich-text control deletion boundaries

The source is `../inline-control-navigation/inline.docx`, independently authored
by `tools/inline_control_navigation_fixture.py`. It contains ordinary A, an
unlocked persistent inline rich-text control holding BC, and ordinary D.

Native protocol: the reference application, September 28, 2026, 946x536 window, 100% zoom.
Open a disposable exact source copy. Click (115,254) to place the caret inside
at the start of BC. Backspace does not change ABCD. Type Shift+X and save:
AXBCD, with XBC in the control. Undo X and repeat Backspace: still ABCD.
Click (132,254) to place the caret inside at the end of BC; Delete does not
change ABCD. Type Shift+X and save: ABCXD, with BCX in the control. Retained
reference outputs and source hashes are bound by reference.json.

These completed UI actions used the computer-use plugin. The source and
references contain no third-party font binaries or template artwork.

ECMA-376 Part 1 17.5.2.26/31 specify the SDT envelope and contents, not keyboard
boundary transitions. This is a reference interaction rule, not a spec contradiction.
The model now ignores outward ordinary deletion at a filled inside boundary,
without changing ownership, history, or serialized data. Inward deletion and
ordinary interior deletion continue consuming text. Empty owned wrappers retain
the separately verified removal behavior in `../empty-control-delete`.

Tests include both native ownership results, repeated keys, exact no-edit
export, typing, undo/redo, unrelated package parts, export/reopen, read-only
behavior and the existing inline navigation/empty deletion regressions. No
layout or paint path is modified. This does not resolve Shift-click, all
outside-boundary behavior, or the wrapping prompt's extra-D selection; corpus
#137 remains partial.
