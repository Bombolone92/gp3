# Mac wrapping flag compatibility controls

Original fixtures built by `tools/mac_wrapping_flag_fixture.py` using the
repository's original drawing generator, python-docx (MIT) and lxml (BSD).
No corpus artwork or separately distributed fonts are included.

Each of six two-page DOCX files contains standalone/grouped pictures, an empty
shape, grouped text, and an unobstructed 120pt text box containing five lines
of wrapped Arial text. Only the extension changes: absent, an omitted `val`,
`false`, `true`, `0`, or `1`. The supported identifier is
`{C572A759-6A51-4108-AA02-DFA0A04FC94B}` with
`wrappingTextBoxFlag` in namespace
`http://schemas.microsoft.com/office/mac/drawingml/2011/main`.

The reference application exports all six variants identically.
`tools/mac_wrapping_flag_reference.py` rasterizes every page at 144 DPI,
asserts RGB equality against the absent flag, and records source/PDF/raster
SHA-256 hashes. The five-line text box on page two was visually inspected.

The importer preserves this metadata without applying a rendering effect.
It continues to validate active `bodyPr` wrapping/autofit independently.
Unit tests cover scene equality, malformed metadata and preservation through
picture resizing, body edits, reopening and exact undo. Browser tests compare
actual page canvases against the absent-flag control and exercise DOCX edits.

No published normative definition for this Mac extension was located. This
is measured reference compatibility, not a claim about its meaning in the
producing application or proof that every unsupported text-body feature is inert. Standard
schema validation covers the enclosing OOXML; it does not provide a published
declaration for this vendor flag. Its accepted structure is checked separately
by the importer and its tests.
