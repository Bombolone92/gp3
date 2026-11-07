# Installed-font layout thresholds

Original OOXML under the repository license, generated independently by
`tools/installed_wrap_thresholds_fixture.py`. No font programs or template art
are included. Six legal-size pages contain 102 paragraphs: 16 M characters at
12 and 28 points in regular Garamond, Arial and Times New Roman. Paragraph right
indents sweep 17 widths in one-twip steps around each outline-derived threshold.
An 8-point label and manual break identify each case. Exact 16-point line height
is intentional; these are wrap controls, not glyph-raster references.

The reference application renders every width sweep monotonically. Every minimum width
equals the outline advance rounded up to the next twip. Actual native font
descriptors, text, hashes and geometry are verified by the recorder. The exact
owned scratch document was closed unchanged without saving.

The browser matches all 102 native line-break results. Editing/export, unrelated
package-part preservation, exact undo and editable reopen also pass. These
checks isolate layout widths from previously recorded export glyph-origin
differences; they do not resolve or excuse those remaining visual differences.
