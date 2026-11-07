# Extending selection out of nonempty rich-text controls

`control.docx` is the independently authored XML/OPC fixture from
`../inline-control-navigation/inline.docx`, produced by
`tools/inline_control_navigation_fixture.py`. Its text is ordinary A, persistent
rich-text control BC, ordinary D. It contains no external artwork or font bytes.

The five `word-*.docx` results were saved in the reference application at 100%
zoom on September 30, 2026. The reference-application opening helper confirmed the exact private
source copy. Actual UI arrow keys and a physical x key produced the edits;
neither the application exporter nor the reference application's range-insertion API generated them.
`reference.json` binds source/result hashes, keyboard sequences and XML contents.

At the start, Home, Right, Right enters the control before B. At the end, End,
Left, Left enters it after C. The first outward Shift+Arrow selects only the
control boundary: typing x retains the adjacent A/D and inserts inside BC.
Continuing outward selects the adjacent character. Rightward replacement stays
inside the control; leftward replacement starts outside and leaves BC unchanged.
Reversing the initial leftward boundary step returns to the same inside caret.

The `*-twice` cases use Undo after the first insertion, then extend again and
type x. The recorded keys include that Undo; they are not independent captures
of two consecutive Shift+Arrow presses without an intervening edit.

ECMA-376 Part 1 fifth edition §§17.5.2.26 (`richText`) and 17.5.2.31 (inline
`sdt`) define the control and its contents. They do not prescribe this keyboard
algorithm. This is observed reference editing compatibility, not a claimed deviation
from a normative OOXML selection rule.

Tests compare text, wrapper ownership and placeholder state against the saved
native packages; they check export/reopen, preserved package parts and exact
undo/redo. Browser tests exercise keyboard events at 100% and 75% zoom.
Unit holdouts cover inward/interior/outside movement and read-only navigation.
The existing empty-control selection suite covers prompt restoration separately.
Adjacent/nested controls, Shift-click, word movement and multi-paragraph
selection are not established by these five native references.
