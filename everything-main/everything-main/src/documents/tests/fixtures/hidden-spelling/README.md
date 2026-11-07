# Document-wide spelling display

These eight neutral packages are manually authored by
`tools/hidden_spelling_fixture.py`; fixed ZIP timestamps make regeneration
byte-for-byte reproducible. They contain ordinary Arial text and no font programs.
They vary only `w:hideSpellingErrors`: absent, present without `val`, and each
of the six Transitional on/off lexical forms. Source document/settings schemas pass.

ECMA-376 Part 1 §17.15.1.52 (printed page 1039, supplied PDF page 1049)
suppresses visual spelling indications, including results from an application's
own spelling engine. Absence permits those indications. §17.17.4 defines the
common boolean property; the settings declaration stays in its original package
part through editing and export.

The reference application opens both `implicit.docx` and `off.docx` on one page.
The former has no spelling underline; the latter underlines `jumpd`. Read-only
inspection of the exact already-open documents reports `ShowSpellingErrors=false`
and `true`, respectively. Both remain saved, and their source hashes match the
authored bytes. `native-observations.json` records these observations.

On the hidden control, F7 shows the reference application's **Turn Off Proofing Exceptions** dialog,
which lists spelling and grammar exceptions. The request was cancelled, with
neither document saved or changed. The reference application's object model still reports
`ShowGrammaticalErrors=true` in both controls: the dialog's text is not evidence
that this spelling flag also disables grammar. The viewer treats the flag as
display suppression and allows explicit spelling review without changing it.
This is a UI behavior difference; no document-specific rendering adjustment is
used. Grammar checking remains outside the supported subset.

Behavioral coverage includes all lexical forms, absent/default behavior, malformed
setting recovery, unchanged settings bytes, exact undo, automatic canvas marks,
context-menu suggestions, explicit F7 correction and editable reopening. Marks
are never serialized or printed. A private original-newsletter comparison verifies
that hiding its four body spelling results changes only the screen proofing overlay.
