# Empty persistent rich-text control deletion

The input is `../empty-control-home-end/control.docx`, independently authored
as OPC/XML by `tools/empty_control_navigation_fixture.py`: A, an empty
persistent inline rich-text SDT named letters, then D. No viewer export was
used to generate the input.

Native protocol, the reference application, September 28, 2026, 100% zoom, 946x536:
open a disposable copy, click (113,254) between A and D, then click (110,254).
Both clicks retain the active empty wrapper. Press Backspace and save. The reference application
removes the SDT envelope without removing A or D. Undo restores the wrapper
and its inside caret; press Delete and save a separate retained result. It
also contains AD with no SDT. The two actual reference outputs and source hashes
are bound in reference.json. Actions used the computer-use plugin.

ECMA-376 Part 1 17.5.2.26/31 describe sdt/sdtContent. They do not prescribe
keyboard deletion stops. This follows the reference application's observed interaction, with no
claimed contradiction of the XML specification. Locked controls remain
rejected by the importer; this does not broaden lock support.

The fix applies only to an explicitly owned inside caret in an empty persistent
inline rich-text wrapper. It leaves the visible text and bookmark offsets
unchanged, clears the removed owner, and creates one undo transaction. Tests
cover both native outcomes, source round-trip, exact undo, redo, subsequent
ordinary deletion, read-only behavior, and six independently authored wrapper
placements including an empty paragraph and adjacent empty wrappers. Existing
nonempty and outside-control edit paths remain covered by control regressions.

This closes the empty-inside deletion case for corpus #137, not all control
boundary behavior. Shift-click, nonempty boundary deletion, and the wrapping
prompt's extra-D selection still need native investigation. Corpus document #137
remains partial.
