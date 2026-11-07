# Nested body page-field controls

Original OPC/XML authored by `tools/nested_page_fields_fixture.py`; no corpus
content or third-party artwork is included. `control.docx` contains seventeen
PAGE/NUMPAGES/SECTIONPAGES envelopes: all simple/complex nesting combinations,
bookmarks inside results, empty children at either parent boundary, three
coincident empty fields, and nested results crossing a paragraph mark. Simple
fields are locked; complex fields are initially unlocked. Arial 12pt and single
line spacing are explicit. `--locked-copy` derives `locked.docx` by adding locks
to the complex begins; it changes no text, geometry or other package parts.

`tools/record_nested_field_edits.ps1` uses verified disposable copies in a private
reference-application instance. Seven native range edits establish insertion,
replacement, empty-result preservation, paragraph splitting, and refilling empty
children at the beginning/end of an outer result. `native-edits.json` includes the
exact source hash, inner/outer results and native body XML. Tests import that
native XML directly as well as comparing the edit results. These are range edits,
not an assertion that every reference-application UI selection chooses the same field boundary.

native reference PDF export refreshes the unlocked page-number results in `native.pdf`. This
is distinct from opening/editing the cached result; update timing is outside
ECMA-376's scope (Part 1 introduction to §17.16). The editor does not yet provide
explicit body-field refresh. `locked-native.pdf` isolates cached-result layout:
all ten lines match wrapping, maximum origin difference 0.0241pt horizontally
and 0.0547pt vertically, with no unmatched lines. The full-page pair was visually
inspected. `tools/record_nested_page_fields.py` records both source/PDF hashes
and native text origins in `reference.json`.

The reader and model preserve nested boundaries in opening order. Empty-result
refill grows the ancestors; partial boundary edits still reject. Same-paragraph
simple fields retain their wrapper inside the current enclosing wrapper. A
paragraph split converts only the affected simple envelopes to complex syntax.
Instructions, flags, bookmarks and unrelated package parts survive export;
undo restores the exact original package.

This is the structural stage of booklet 15's missing nested TOC/PAGEREF support.
MACROBUTTON prompt semantics, fields nested in code,
and fields crossing cells/sections remain unsupported for editing. The separate
`nested-body-fields` TOC/prompt fixture remains an unresolved integration case.
The document corpus completion count is unchanged.
