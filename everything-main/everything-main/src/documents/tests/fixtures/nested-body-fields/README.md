# Nested body-field control — unresolved editing support

`tools/nested_body_fields_fixture.py` authors original OOXML using the project's
independent inline-object-baseline package scaffold. No corpus content or artwork
is copied. Arial 12pt and single line spacing are explicit, including paragraph
marks. The two-page control contains:

- A TOC whose cached result spans two paragraphs.
- Two complex PAGEREF fields inside that result, pointing to distinct bookmarks
  on page two, both with cached result `2`.
- Ordinary paragraphs before and after the outer field.
- Two MACROBUTTON DoFieldClick prompts, one without a cached result and one with
  a cached result, using quoted display text. These are data, not executed macros.

The reference application opened the exact source read-only and exported the
two-page `native.pdf`. It displays both TOC lines/page numbers and both quoted
prompts. `tools/record_nested_body_fields.py` records source/PDF SHA-256 hashes
and native character origins independently of the editor. Both package XML
schema checks pass.

On main 53bbdfbe, strict import rejects `nested body fields`; the fallback opens
two read-only pages with the cached contents/prompts and exact no-edit ZIP-part
preservation. These are baseline controls for an unresolved feature, not a
passing editable-field regression or a claim of complete visual fidelity.

The current reader and range model both assume one active field, while the
shared instruction parser accepts only page-count/number fields. Fixing the
reader's stack alone is insufficient. Implementation must preserve outer/inner
envelopes and delimiter order through paragraph edits, serialize nested cached
results without flattening them, retain bookmarks/instructions/flags, and define
refresh/editing behavior for TOC/PAGEREF and uncached prompt fields. Add independent
cases for coincident/empty boundaries, nested simple/complex fields, malformed
crossings, selection deletion, table boundaries, export/reopen and exact undo.

Relevant specifications: ECMA-376 Part 1 §17.16.1 (field syntax), §17.16.5.34
(MACROBUTTON) and §17.16.5.45 (PAGEREF). No new reference/spec divergence is asserted
by this baseline. Do not simply remove the guard or turn retained fields into
ordinary text to make the source editable.

The structural stage is now implemented for nested cached numeric fields, with
independent native editing/visual controls under `../nested-page-fields`. This TOC
and prompt control now gets past TOC/PAGEREF instructions but still rejects the
MACROBUTTON prompts. Their visible label belongs to the instruction rather than
the cached result; editable support and full appearance verification remain pending.
