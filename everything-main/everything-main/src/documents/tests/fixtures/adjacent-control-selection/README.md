# Adjacent rich-text control selection

`control.docx` is independently authored OOXML: ordinary A/D text surrounds
adjacent persistent inline rich-text controls BC and EF. Generate it with
`python tools/adjacent_control_selection_fixture.py`; the envelope comes from
the independently authored inline-control-navigation fixture. No corpus
artwork or font files are included.

`reference.json` binds the input and four saved native reference results by SHA-256.
Results were captured in the reference application at 100% zoom by physical keyboard
input and Ctrl+S, rather than by the viewer exporter or range insertion through the reference automation API.
Each experiment starts from a fresh source copy. The JSON records every setup
and experiment key and the resulting document/control text.

| Case | Starting caret | Experiment | Native outcome |
| --- | --- | --- | --- |
| right-twice | Inside BC, after C | Shift+Right twice, x | ABCxEFD; BCx / EF |
| right-continued | Inside BC, after C | Shift+Right twice, x, Undo, Shift+Right, x | ABCxFD; BCx / F |
| left-twice | Inside EF, before E | Shift+Left twice, x | ABCxEFD; BCx / EF |
| left-reversed | Inside EF, before E | Shift+Left twice, x, Undo, Shift+Right, x | ABCxEFD; BC / xEF |

The continued/reversed experiments include undo; they are not recordings of
three consecutive arrow presses. The shared boundary adds a zero-width stop.
Backward replacement at that stop belongs to the preceding wrapper; reversing
the boundary step restores the original wrapper. The baseline viewer deleted E
prematurely in right-twice at browser zooms 1 and 0.75.

Unit/browser tests verify hashes, native text and wrapper ownership, export and
reopen, untouched package parts, and exact undo/redo. Browser cases run at both
zooms. ECMA-376 Part 1 sections 17.5.2.26 (richText) and 17.5.2.31 (inline sdt)
describe the markup, not this keyboard algorithm; this is measured reference
compatibility evidence. Shift-click, adjacent empty controls, nested controls,
and selection across paragraphs are not established by these four results.
The native automation API has no held-modifier click operation, so keyboard
results must not be represented as native Shift-click evidence.

## Continued selection through the neighboring control (2026-10-01)

`far-boundary-reference.json` binds two additional saved reference results to the
same source. From inside BC after C, five consecutive Shift+Right presses and x
produce ABCxD, retaining only BCx. From inside EF before E, five consecutive
Shift+Left presses and x produce AxEFD, retaining only EF; x is ordinary text.
These experiments contain no intervening insertion or undo. Both fully selected
neighboring wrappers disappear. The baseline viewer skipped the far boundary
stop and, backward, incorrectly retained a wrapper around the replacement.

Capture used physical keys in the reference application at 100% zoom. Save As retained
compatibility with previous versions; the format-upgrade prompt was canceled.
`native-far-right.docx` and `native-far-left.docx` are the completed native saves.
`tools/record_adjacent_control_far_selection.py` reads their XML independently
of the viewer to record the resulting text, wrapper contents, flags and hashes.
The new unit/browser cases check both directions, two browser zooms, export,
reopen, retained parts and exact undo/redo. The broader limitations above remain.
