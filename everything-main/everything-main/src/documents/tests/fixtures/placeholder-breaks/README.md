# Multiline glossary placeholder reference

`tools/placeholder_breaks_fixture.py` derives a new original OPC fixture from
the project's original persistent-inline glossary control. Its referenced
prompt contains bold blue text with one default `w:br` and one `w:cr`.
The initial visible control contains an ordinary value, so deleting it tests
resolution of the glossary definition rather than reuse of a visible cache.

The reference application opened the exact source read-only in an owned COM
instance. Deleting the range of the control titled `insert` restored the three
prompt lines and set `ShowingPlaceholderText=true`. `restored-native.xml` is the
main document part extracted from the reference application's Flat OPC capture after deletion;
`restored-native.pdf` is the corresponding native PDF export. The document was
closed without saving the source. Hashes and paragraph/control counts are in
`manifest.json`. All content is original test content, not corpus artwork.

The reference application retains the inline wrapper and all ten paragraphs/controls. The restored
run content retains both break elements and its bold/color formatting. This
agrees with the specified run-break behavior; no reference/spec divergence is claimed.
The application normalizes restored manual breaks to `w:br` on export while
leaving the original glossary bytes intact. Tests also cover explicit wrapping
breaks, page breaks, rejected column/clearing breaks and malformed elements.
