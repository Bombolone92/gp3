# List-level paragraph properties, picture nvPr and unopenable link targets

Generate with `python tools/list_borders_retained_links_fixture.py`. The generator
uses only Python's standard library and an original 8×8 PNG, not a corpus
document, external artwork or another engine. ZIP timestamps are fixed.

`combined.docx` reproduces the declarations reported in issue #69:
`w:pBdr`, `w:spacing`, `w:jc` and `w:keepNext` inside numbering levels (direct,
style-applied and nested lists, plus direct `nil` border and `after="0"` spacing
overrides and a style `before="0"` that outranks style-applied numbering), a
`pic:nvPr` after `pic:cNvPicPr`, and External hyperlink
relationships whose targets are a relative path with spaces, a `file:` path with
backslashes, and an ordinary web address. A picture `wp:docPr` link also points at
a relative file.

`word/numbering.xml` and `word/styles.xml` pass the transitional XSDs. As in the
reported document, `word/document.xml` does not, solely because of `pic:nvPr`,
which is outside CT_PictureNonVisual.
