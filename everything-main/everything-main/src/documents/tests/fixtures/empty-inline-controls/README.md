# Empty persistent inline rich-text controls

These fixtures are independently authored OPC/XML, with native
references recorded September 25, 2026. No app export generated the source or
native references.

- `control.docx`: six empty wrappers at paragraph start, middle, end, in an empty
  paragraph, and adjacent at one text offset. `native.pdf` records their layout.
- `native/`: follow-up reference operations on the independently authored block
  fixture after its boundary deletion produced an empty inline wrapper.
- `glossary/`: two block controls referencing a bold, single-paragraph glossary
  prompt. Deletion and replacement across the start restore that prompt inside
  the converted inline control, for both filled and already-showing controls.

Reproduce the XML fixtures with `tools/empty_inline_control_fixture.py` and
`tools/empty_inline_glossary_fixture.py`. Record the reference edits with
`tools/record_empty_inline_controls.ps1` and
`tools/record_empty_inline_glossary.ps1`. Export `control.docx` through
`tools/export-reference.ps1`, then run
`tools/record_empty_inline_reference.py` to bind sources/results/PDF to hashes.
The block boundary source is the committed native result named in that manifest.

The reference application retains an empty control when deleting neighboring text. Typing inside
fills it; clearing entered text restores five spaces when no glossary prompt
is declared. The reference application also has positions immediately outside the control that share
the same visible text offset: inserting there leaves the control empty. The
model defaults to insertion inside when given only a text offset. Ordinary
Left/Right navigation now distinguishes inside/outside ownership; see the
`../inline-control-navigation` and `../empty-control-navigation` references.
Pointer ownership and comprehensive modified-key behavior remain pending.

The `Range.Text = "X\rY"` probe reports an error but changes the empty control to
the five-space placeholder first. This automation-API error side effect is recorded as a
reference automation API quirk, not a keyboard-editing oracle. The editor keeps its existing
atomic rejection of paragraph breaks inside an inline control.

Tests cover import/no-edit byte preservation, reference-matched insertion and
neighbor deletion, export/reopen/undo, zero-width ownership through surrounding
search/format/split edits, and glossary restoration. No sentinel character is
inserted into user text. The independent page has the same browser pixels with
and without its empty wrappers; its native and browser pages were inspected.
