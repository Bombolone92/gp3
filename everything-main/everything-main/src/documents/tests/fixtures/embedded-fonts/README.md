# Embedded font controls

Independently authored OPC packages from `tools/embedded_font_fixture.py`.
No document from the user's corpus is redistributed. The fonts are unchanged
Source Sans Pro Regular/Bold/Italic/BoldItalic and Bebas Neue Regular from the
already reviewed `public/fonts` assets. Their corresponding source, pinned
hashes and OFL-1.1 licenses are documented in `public/fonts/PROVENANCE.md`,
`SourceSansPro-OFL.txt`, `SourceSansPro-1.075-OFL.txt` and `BebasNeue-OFL.txt`.
Obfuscation affects only the package representation, not the decoded font.

Exported independently by the reference application using
`tools/export-reference.ps1`. `record_embedded_fonts.py` records source/PDF
hashes, native baselines and glyph origins. Cases:

- `four-faces`: a noninstalled document name with all four embedded forms.
- `second-family`: that same document name with a different embedded font.
- `empty-bold`: a valid regular face plus an empty bold part; the reference application synthesizes
  the missing forms without discarding the regular face.
- `raw-font`: unobfuscated TrueType with a zero GUID and `application/x-font-ttf`.
- `installed-name`: embedded Source Sans faces declared as Arial. The reference application uses
  installed Arial instead. The browser must produce exactly the same geometry
  as the same package without its embed declarations. Existing installed Arial
  kerning differs from the reference application for some glyphs; this case asserts selection,
  baseline agreement and invariance, not identical native glyph advances.

The other four native cases compare every glyph origin within 0.35 pt and
baselines within 0.2 pt, including synthesized bold/italic. All five compare
no-edit package bytes, retained parts after editing, exact undo and reopening.
Additional browser cases exercise document isolation, external-reference
rejection, preview/print restrictions and the font picker. Pure tests cover
GUID ordering, raw/obfuscated inputs, relocated parts, invalid relationships,
empty fonts, content reuse, permissions and preserved source declarations.

These controls validate font embedding and its existing rendering paths.
They do not establish conformance for every font format, shaping table or script.
