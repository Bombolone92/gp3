# Original drawing-text alternate control

`tools/drawing_text_alternates_fixture.py` manually authors an MCE container
with a modern WPS text frame and a legacy VML text frame. Their WordprocessingML
paragraphs are identical. Two neighboring group frames come from the original
authored drawing-text control. No corpus content, third-party artwork, font
programs or proprietary document-engine implementation is included.

The source was generated into an owned scratch directory, opened with the reference-opening
helper, and edited with `tools/record_open_drawing_text_edits.ps1`. The recorder
checked its exact moniker, source hash, saved state, paragraph/shape counts and
frame text before replacing the standalone and left-group title prefixes. It
saved `native-edited.docx` separately and verified that the source bytes stayed
unchanged. `native-edits.json` records native text, formatting and frame sizes.
The supplied native reference also creates alternate branches for the group.
Its modern and legacy branches contain the same edited standalone/group text.

`hashes.json` binds the retained bytes; the generator is compared by uncompressed
parts because ZIP timestamps vary. JSON capture bytes are preserved by Git.
Tests verify the native evidence, import/no-edit retention, rich edits to every
corresponding branch, unchanged neighbor/parts, export/reopen and shared undo/redo.
Browser checks verify the real context-menu draft, repaint, cancel, export and
undo. Stale formatting and repeated indistinguishable source frames stay guarded.

Mapping compares complete namespace-aware WordprocessingML trees, not visible
strings, template filenames, shape names or assumed group-child order. Prefixes,
namespace declarations and XML indentation are immaterial; every semantic
attribute, run/property boundary and preserved text space is compared. Each
branch needs exactly one corresponding story for an editable frame. Nested
alternate containers, raster-only fallbacks, changed/stale branches, ambiguous
duplicates and currently unsupported drawing-text controls/tables/fields remain
unfinished. This is serialization/editing evidence, not full layout certification.
