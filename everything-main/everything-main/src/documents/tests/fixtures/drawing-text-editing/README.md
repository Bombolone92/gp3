# Drawing text editing: native controls and rich drafts

`tools/drawing_text_editing_fixture.py` independently constructs the original
OPC/XML using Python's standard library. The fixture contains a standalone WPS
text frame and two text-bearing children of a WPG group. Each has a bold first
paragraph and a regular second paragraph, with explicit ordinary local Arial.
There is no corpus content, artwork, or font program in either package.

The reference application opens the source as one page. Its object model exposes one text
shape and one group with two children. On an exact helper-opened owned scratch
copy, `tools/record_open_drawing_text_edits.ps1` replaces the first word in the
standalone title and left grouped title. It saves a separate `native-edited.docx`.
The neighboring frame, second paragraphs, and bold/regular distinction survive.
The original file bytes remain unchanged. This is native Range behavior, not
evidence that every pointer, selection, IME, or keyboard interaction is correct.

`native-before.emf` is the independent native page capture from the unmodified
source. `native-page-capture.json` and `native-edits.json` bind those observations to
the source. `hashes.json` binds all retained artifacts. The saved reference is
not a fixture generator or input for application rendering. Source regeneration
is compared by uncompressed ZIP parts; container timestamps are not deterministic.

At the recorded baseline, the application rendered all three text frames on one editable page, but
their text is not part of the editable body position space. Clicking the visible
standalone title selects its drawing object. Native-result import/no-edit tests
do not imply that the editor can perform the recorded text edits.

Required work includes drawing-story ownership, targeted serialization retaining
group/shape properties and alternative branches, rich paragraph/run formatting,
geometry-aware selection/carets, shared undo, atomic cancellation, export/reopen,
and invalidation of only the edited preview. Group text must not become body text
or be replaced by a flattened string. Existing fields, controls, table content,
header/footer instances, rotations/reflections and frame overflow need explicit
ownership and regression coverage. This is a feature gap, not a claimed
normative contradiction between the reference application and OOXML.

The first implementation now offers **Edit drawing text → Text frame** through
the drawing context menu. A rich draft can reproduce both native replacements,
preserving paragraphs and bold/regular runs. Apply is one shared undo step and
Cancel changes no document content. Tests cover mixed formatting, new paragraphs,
header-part ownership, guarded controls/alternatives, repainting, export/reopen,
and exact original package-part restoration. Subsequent independent suites cover
controls/tables, retained page fields, symbols, existing pictures, and equivalent
alternate branches: `drawing-text-structures-native`, `drawing-text-fields`,
`drawing-text-symbols`, `drawing-text-pictures`, and `drawing-text-alternates`.
Direct transformed text selection and caret editing remain pending. Differing or
ambiguous alternate stories remain guarded; this fixture does not certify every
corpus drawing.
