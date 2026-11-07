# Retained header and footer tables

`tools/page_story_tables_fixture.py` manually authors a two-page original
control: a shaded header table with a spanning row and dynamic PAGE field,
and a footer table with nested contact cells, shading and an original square
picture resolved through the footer's own relationship part. No private
template text or artwork is included. The reference application exported
`native.pdf` without saving changes to the DOCX. The reference script records
source/PDF hashes and printed line origins independently of the renderer.

Both reference pages and both browser pages were visually inspected. The browser
oracle groups same-baseline cell text in reading order and checks every
printed line, initial x origin and baseline within 0.2pt. It checks two-page
pagination, fourteen rendered cells, changing PAGE values, body-only native
editing, no-edit package equality, unrelated-part preservation, exact undo
and reopening. Unit tests also force body repagination and verify that story
tables and image relationships remain separate from the body table registry.

The importer reuses the ordinary table/block readers with a story-local table
registry. Tables, nested tables, merges, row geometry, backgrounds, borders
and cell clipping use the existing generic layout and painter. Translating
the story shifts cell and clipping bounds as well as text and borders. Cell
drawings resolve against translated physical cells. Header/footer parts stay
unchanged during body edits; direct story editing is not enabled. Unsupported
story bookmarks and links still reject editable import rather than sharing
body identity/relationship scopes. Field instructions outside the existing
PAGE/NUMPAGES/SECTIONPAGES subset remain unsupported.

The independent nested-terminal-paragraph control fixes the generic empty
paragraph allocation discovered by this nested footer. No footer-specific
height correction is applied. The standalone image-only footer descent rule
does not trim table rows.

Validation: 55 unit tests and 14 browser cases pass; seven drawing/table cases
were rerun after the final standalone-picture guard. Source/export checks pass
(261 initial XML checks plus 113 final-export checks). Production build and
license checks pass. The actual invoice that exposed the gap now shows its
footer, but remains read-only because a different header uses an unsupported
numeric PAGE format switch. No such switch is silently discarded.
