# Original drawing symbol controls

`tools/drawing_text_symbols_fixture.py` independently authors three WPS text
frames: a standalone frame and two group children. Each has adjacent Courier New
text and an explicit Arial `w:sym`. Controls cover uppercase and small-cap run
properties with lowercase symbol code 0061, plus uppercase code 0041. The literal
control replaces only each symbol run with the equivalent ordinary Arial glyph,
leaving neighboring text properties unchanged. No corpus text, artwork, font
programs or third-party document-engine implementation is included.

The source was generated in an owned scratch directory and helper-opened in the reference application.
`tools/record_open_drawing_symbol_edits.ps1` verified its exact moniker, source
hash, saved state, frame structure and text before editing two title prefixes.
It saved `native-edited.docx` separately and verified the original bytes stayed
unchanged. `native-edits.json` records the reference application build, frame sizes, surrounding font and
caps properties. The reference application exposes the symbol as COM character 40; that placeholder
is not a glyph rendering reference. The saved OOXML preserves the explicit font
and character code in standalone and grouped text stories.

`hashes.json` binds source, literal, cases and native evidence. Regeneration is
compared by uncompressed ZIP parts because timestamps vary. Tests verify exact
no-edit retention, neighboring edits, formatting, atomic replacement/deletion,
export/reopen and exact undo. The browser requires installed Arial and Courier
New through ordinary CSS font probes, compares the complete source/literal page
pixels and applies a real context-menu rich draft. This establishes internal
glyph equivalence and editing retention, not new native pixel equivalence or complete
layout certification. No Local Font Access or font program extraction is used.
