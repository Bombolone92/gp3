# General numeric page-field formats

`tools/general_page_fields_fixture.py` manually authors this original five-page
DOCX in `public/fixtures/general-page-fields.docx`, without corpus content or
embedded fonts. The reference application opened it read-only and exported
`native.pdf` without saving the source. `tools/reviewed_font_reference.py
general-page-fields` records independent PDF glyph origins and baselines;
SHA-256 hashes bind both source and reference.

ECMA-376 Part 1 sections 17.16.4.3 and 17.16.4.3.1 define general numeric
formatting. Controls alternate simple/complex fields with stale 99 caches,
restart numbering at 0, 1, 12, 27 and 54, and include an upper-Roman section.
They exercise Arabic, ArabicDash, ROMAN, roman, ALPHABETIC and alphabetic,
MERGEFORMAT in either order, numeric pictures in either order, NUMPAGES,
SECTIONPAGES and conflicting repeated general formats.

The reference application uses the explicit format instead of section numbering. Roman/alphabetic
zero is a blank space; alphabetic values repeat a letter (27=AA, 54=BBB).
ArabicDash is a literal '- ' prefix and ' -' suffix. Numeric pictures take
precedence regardless of order. The last repeated general numeric format wins.
The latter precedence details are recorded as observed reference behavior, not
asserted to be additional explicit requirements of the specification.

Browser checks compare all 80 reference lines, glyph origins, baselines and
closing-bracket positions, then verify exact no-edit package parts, surrounding
edits, unrelated-part preservation, exact undo and editable reopening. Unknown
general formats remain guarded; this does not implement every language-specific
number format or general text/character formatting switch.
