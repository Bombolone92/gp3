# Persistent inline rich-text controls

`tools/persistent_inline_control_fixture.py` manually authors the original OPC/XML
fixture. It contains ten independent inline controls, including omitted and false
`temporary` values and a placeholder. The source passes the ECMA-376 schema check.

The reference application opened the exact source path and exported `baseline-native.pdf`.
Each operation ran in a custom undo record, captured the reference application's document XML, then
undid the operation. The reference application closed without saving the source. The retained XML
files are the reference application's document part extracted from its Flat OPC snapshots, including
the other untouched controls. JSON stores the observed text, placeholder flag,
control count and XML hashes. No user document content is included.

Insertion, whole/partial replacement, formatting, replacement of placeholder
text and explicit `temporary=false` retain the wrapper. Deleting all its text
retains it and generates a five-space placeholder. Collapsed ranges explicitly
derived from the control's own start/end insert inside it. These COM range probes
do not establish which side a mouse caret selects at a visually shared boundary;
that interaction still requires separate testing.

The reference application rejects `Selection.TypeParagraph` inside the inline control with a limited
editing-zone error. That is recorded as an error outcome, not a successful edit.
No split XML is fabricated. The remaining probes ran after reopening the original.

Relevant standard: ECMA-376 Part 1 §§17.5.2.31/36 (run-level control/content),
17.5.2.26 (rich text), 17.5.2.39 (placeholder state), 17.5.2.43 (`temporary`) and
17.17.4 (boolean properties). An omitted `temporary` explicitly preserves the
wrapper on edits. These results do not establish a reference/spec divergence.

The companion `persistent-inline-glossary.docx` declares an original glossary
placeholder through an OPC relationship. `glossary-delete-native.xml` records the reference application
restoring “Enter name” in bold blue after deleting that control's contents. Both
the main and glossary parts passed independent schema validation. Tests exercise
the same restoration after editing and reopening, plus bookmarks, hyperlinks,
search replacement and exact undo/package preservation.
