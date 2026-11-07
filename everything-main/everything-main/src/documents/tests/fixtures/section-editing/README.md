# Section-boundary editing controls

`tools/section_editing_fixture.py` independently authors six deterministic OOXML
packages, using only the Python standard library. Each contains three next-page
sections with distinct dimensions, left margins, and explicit default headers.
`formats.docx` gives Bravo right alignment and Charlie center alignment;
`table.docx` places a one-cell table between Charlie and Delta. `boundary-table`
places the table directly after Bravo's section break. `inheritance` omits later
story references and inherits all default/first/even header/footer variants;
`implicit-final` also omits the optional body-owned final `sectPr`.

`reference.json` records paragraph text/alignment, section geometry/default
header text, and table counts from 24 separate reference-application SaveAs2 exports. The inherited
controls also record all six story variants and the first-page flag. The boundary
table control records paragraph cell ownership. The reference application edited visible, already-open owned copies with detached `Range.Text`,
saved fresh separate references, and undid each edit. The original authored files
were unchanged. No font programs were inspected. Native exports remain private;
their hashes and the independent source hashes are recorded in the reference.

Ranges use the reference application's zero-based, end-exclusive positions. `delete-first` deletes
26..27, `replace-first` replaces 24..29 with `Edited`, and `multiline` replaces
24..29 with `One\rTwo`. `replace-to-second` ends two characters into Delta,
`replace-both` ends two characters into Echo. Those endpoints are 44 and 59 in
formats, and 58 and 73 in the table control. Native cell/end-row marks occupy
additional positions compared with the editor's flattened paragraph model.

Deleting the first boundary retains the following section's landscape geometry,
36 pt left margin and Header 2. Merged paragraphs take the ending paragraph's
alignment; inserted paragraphs in the multiline case are also centered. A body
selection enclosing the whole table removes the table. The reference application rejected the tested
24..44 replacement ending partway into the table cell with “The range cannot be
deleted.” That COM observation does not establish every keyboard/table selection
policy.

At a break directly before the table, deleting/replacing 26..27 moves the retained
body prefix into the first cell and adopts its paragraph formatting. Replacing
the break with `One\rTwo` creates two paragraphs in that cell. This preserves the
table; a body selection surrounding the entire table removes it instead.

`native-boundary-commands.json` records native Selection.Delete and TypeBackspace
commands on the visible owned boundary-table control, with exact baseline text
and section-count checks and native undo. Forward Delete matches the range edit.
Backspace at the first cell's start deletes the preceding body's last character
while retaining the section break. The editor now follows this native editing
observation for a nonempty body
paragraph immediately before the first table cell. Empty preceding paragraphs
retain the table-boundary guard, since their native keyboard behavior has not
been established. Undo restores the original cell caret; deletion reuses ordinary
grapheme/field/control protection rather than consuming the section mark.

These controls establish editing semantics, not native glyph/pagination fidelity.
The first candidate was withheld because live page stories still used original
section indices. The implementation now carries surviving section identity,
remaps live stories, and materializes only inherited references whose meaning
would change during export. Unit/browser checks cover reopening, exact OPC undo,
live versus reopened paint, and story edits preceding section deletion. Partial
cell selections and partial field boundaries retain their independent guards.

To reproduce the native semantic metadata, use `tools/record_section_editing_native.py`
with `--native-dir` pointing at the owned native sources and separate exports and
`--native-state` pointing at the formats control's captured native state. The
recorder checks that the four recorded sources and boundary-table source remain
identical to the independent fixtures. It only reads package XML and story text.

Relevant ECMA-376 Part 1 clauses: 17.6.17–18 (final and paragraph-owned section
properties), 17.10.2 and 17.10.5 (footer/header references and inheritance).
The standard describes storage and inheritance; the editing observations above
are observed native behavior, not a claimed normative editing rule or spec divergence.
