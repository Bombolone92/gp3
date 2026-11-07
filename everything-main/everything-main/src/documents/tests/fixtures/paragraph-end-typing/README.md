# Paragraph-wide direct formatting and Enter

`tools/paragraph_end_typing_fixture.py` authors four deterministic OOXML packages
with Python's standard library. They do not use the application serializer.
All have distinct text and paragraph-mark formatting so that blindly inheriting
the last glyph after Enter would be an observable error.

In `toggle-body` and `toggle-cell`, the entire eleven-character paragraph text
is selected without the paragraph mark and Bold is enabled. In the reference
application, the saved mark also becomes bold, with ordinary and complex
script bold declarations. After collapsing the selection with Right, Enter and
typing `Added paragraph`, both the new mark and text remain bold and italic.

The native exact selections use Ctrl+Home and eleven Shift+Right keys. The
owned files were saved before Enter to establish that formatting the mark is a
consequence of the formatting command, rather than a transient typing format.
`partial-body` moves Right seven times before selecting the eleven trailing
characters: Bold changes those characters but leaves the mark unbold.

`body` already contains a bold, italic blue last run and a regular mark. Without
the formatting command, Ctrl+End, Enter and typing produces regular black text.
Its first inserted mark takes the preceding run's bold/italic/blue formatting;
the final original mark and new text remain regular. The editor's existing
split behavior matches this control and must be retained.

The owned scratch copies were opened with the reference-application helper before Windows UI
automation, edited using the reference application's keyboard commands, and saved locally. Original
authored fixture bytes remain unchanged. `reference.json` records source
and native package hashes plus only document XML declarations. No native font
programs, proprietary source documents or corpus artwork are distributed.
The recorder is `tools/record_paragraph_end_typing_native.py --native-dir PATH`.

ECMA-376 Part 1 §§17.3.1.29 and 17.3.2.28 define paragraph-mark and text run
properties. The full-paragraph selection rule is native reference editing behavior;
the standard does not prescribe keyboard or selection-command behavior, so no
normative contradiction is claimed. The fix changes direct formatting, not
character-style application or paragraph splitting.

Unit tests compare the independent native declarations before Enter and after
typing, plus round trips, unrelated parts and exact undo/redo. Browser checks
exercise accessible toolbar state, typing, edited reopening and pixel/package
undo. Pixel comparisons collapse selections first so highlights are not mistaken
for changed document content. These are editing checks, not native raster agreement.
