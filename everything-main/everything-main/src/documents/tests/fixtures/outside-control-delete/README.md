# Outside deletion into persistent inline rich-text controls

Source: `../inline-control-navigation/inline.docx`, independently authored by
`tools/inline_control_navigation_fixture.py`. It contains ordinary A, a persistent
unlocked rich-text SDT holding BC, and ordinary D. No template artwork or font
binaries are included.

Native reference: The reference application on 2026-09-29, through the
computer-use plugin's physical key actions, 100% zoom. A disposable exact copy
was opened and the editing surface focused. Ctrl+Home, Right, Delete selects
BC without deleting text. Ctrl+End, Left, Backspace does the same from the other
side. The screenshot and accessibility `selected_text` both showed BC.
The next same deletion key clears the contents but retains an empty SDT.
Saving at this point produces the two `*-twice.docx` references.

Undo restores the selected BC. Shift+X replaces it with X inside the control;
`native-selected-type.docx` records AXD and control content X. A separate ordinary
selection route (Ctrl+Home, Right twice, Shift+Right twice, Delete) also leaves
the empty wrapper, recorded in `native-shift-selection.docx`. Cases reused the
same disposable document after Undo; the manifest lists equivalent routes from
the unchanged source and binds every saved result by SHA-256.

ECMA-376 Part 1, fifth edition, 17.5.2.31 and 17.5.2.36 describe the inline SDT and its content, not
keyboard deletion transitions. This is reference interaction compatibility, not a
contradiction of a normative keyboard rule. It supplements the existing
inside-boundary and empty-control references. The editor's direct replacement
API retains its existing prompt-restoration behavior; the user deletion command
keeps an empty rich-text control until exit.

The first outside deletion changes only selection and creates no undo entry.
The second creates one undoable edit. Typing, export/reopen, unrelated package
parts, exact undo/redo, read-only guards and prompt restoration on exit are
covered. Picture, plain-text and temporary controls keep their existing paths.
This does not establish all modified-pointer or boundary-navigation behavior,
nor complete template #137's fidelity audit.
