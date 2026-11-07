# Index fields within content controls

Independent, manually generated OOXML from
`tools/content_control_index_fields_fixture.py`. No corpus XML is copied.
The fixture contains eight paragraphs and eight complex XE fields with split
instruction runs and no separator/result. Cases cover a plain field, temporary
and persistent inline rich-text controls, both inline control boundaries, a
temporary block control, adjacent fields, and a visible text reference.

`native.pdf` was captured with `tools/export-reference.ps1` using the reference
application. The exporter confirmed the document's FullName,
repaginated it, and exported one page. That full page was visually inspected.
`reference.json` binds the source and PDF hashes and records all eight
extracted visible lines. Every L/R pair is contiguous: XE contributes no visible
text or space. The source passes both applicable transitional XSD checks.

The final fixture explicitly uses Arial 14pt and an exact 24pt line height.
The initial version left formatting unspecified: this reference application installation chose
Aptos, and the browser comparison exposed a 0.610pt first-baseline difference.
That default-font issue is separate and remains unresolved; explicit formatting
makes this field/control reference reproducible across application defaults.

`native-edits.json`, captured by `tools/record_index_field_edits.ps1`, records six
independent in-memory reference edits, bound to the source hash. The reference application leaves XE before
text inserted at its position, including two adjacent entries. A temporary
control unwraps after text insertion but retains the entry; a persistent control
keeps both. Formatting retains the temporary control, while replacing its whole
contents removes the entry. The recorder verifies FullName and closes only its
own documents/application without changing the source.

The unit tests compare native visible text, field positions and control ownership
through export/reopen, and verify exact undo. Browser checks compare all eight
native line origins from `tools/record_index_field_positions.py`, then exercise
adjacent typing, temporary-control unwrapping, download, undo and reopen.
INDEX generation is not established by this reference and remains unsupported;
cached INDEX results are retained and editable, like cached TOC results.
