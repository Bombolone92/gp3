# Empty-control exit and prompt restoration

The independently authored sources contain A, an empty persistent inline
rich-text control, and D. `glossary.docx` also includes a declared single-paragraph
bold Arial prompt, `First prompt`. Reproduce the source markup with
`tools/empty_control_navigation_fixture.py`; ZIP timestamps may differ. The
manifest binds the exact sources used for the reference application captures.

The reference application UI captures use real arrow keys, Ctrl+Home, Ctrl+S, Ctrl+Z, and the
physical Shift+X chord through Computer Use. One Right reaches the outer boundary;
the second enters the empty control. Neither changes its contents or enables
Undo. The third leaves the control and restores the default five spaces or the
declared prompt, enabling Undo Create Content Control. Undo restores the empty
wrapper and its inside caret. Leaving in the reverse direction restores the same
prompt, with the caret before it. The reverse-exit capture starts from the inside
caret restored by Undo; its manifest gives the equivalent route from the source.

Typing after the glossary prompt inserts outside it with the following text's
formatting, not the bold prompt's formatting. The model regression checks that
against the saved reference result. Before/inside native saves are byte-identical to
the source; the reference application's undo save is semantically empty but rewrites package metadata.
The editor additionally guarantees exact original package bytes after undo.

The implementation restores on ordinary Left/Right exit, reusing the same model
path as clearing an existing control. It preserves adjacent empty wrappers and
declared prompt formatting, produces one undo step, and never mutates a read-only
preview. Empty inside carets have focus-only caps. Pointer-driven
entry/exit, comprehensive Home/End and modified-key behavior, and other remaining
control UI gaps still require work. No fonts or artwork are bundled.
