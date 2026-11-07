# Word-unit caret navigation

`tools/native_navigation_fixture.py` authors the 25-paragraph source with standard
library OPC/XML construction. It covers ordinary/repeated/leading/trailing spaces,
NBSP, tabs, manual and paragraph breaks, punctuation runs, hyphens, underscores,
apostrophes, decimal punctuation, combining marks, Greek/Chinese text, emoji and
ZWJ sequences. Significant text whitespace explicitly declares `xml:space`.
The shared source helper includes an unused original repository PNG. Source,
fixture artwork and authored text use the repository MIT license; no corpus
content, third-party document engine or font program is included.

The reference application opened an exact owned scratch copy using the
reference-application helper. `tools/record_native_navigation.ps1` observed detached `Range.Move`,
`MoveStart` and `MoveEnd` calls with `wdWord`, without selecting text in the UI,
editing the document, saving, changing application settings or quitting the reference application.
Saved state and the source hash are checked before and after observation.
`native-ranges.json` binds 268 UTF-16 caret positions in both directions, extensions,
and eight movements from four selected ranges. This is native word-unit evidence,
not a capture of every keyboard gesture or content-control ownership behavior.

Ctrl+Left/Right and Shift+Ctrl+Left/Right use those unit endpoints. Words consume
following ordinary/NBSP spaces; punctuation and structural breaks occupy units.
Nonempty selections collapse to the containing boundary rather than taking an
additional unit. Final paragraph-marker positions are bounded by the editor's
existing text model. The unit test checks all captured offsets; browser keyboard
carets use the 265 legal grapheme boundaries, preserving the existing rule against
placing a caret inside a combining/ZWJ sequence. All movement targets match the
reference. Real browser key presses separately check word replacement and undo.

The source reproduces byte-for-byte. Tests also verify unchanged layout and
source parts after navigation, unrelated parts after editing, edited reopening
and exact undo. The Alt/Option path remains unchanged pending a separate native reference.
Language-specific linguistic segmentation and untested control/field ownership
are not certified by these default-language text controls.

To recapture, generate a fresh directory, open its exact source with the
reference-application helper, and call the recorder with `-Source`, a fresh `-Output`, the expected
source SHA-256 and `-SelectionCases selections.json`. Validate the returned text
against `cases.json` before using the data. The reference application remains open and unchanged.

This is editor interaction behavior, not an OOXML layout algorithm. The relevant
source representations are ECMA-376 Part 1 §§17.3.1, 17.3.2.25, 17.3.3.1,
17.3.3.31 and 17.3.3.32.
