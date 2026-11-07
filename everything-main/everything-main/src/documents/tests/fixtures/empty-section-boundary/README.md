# Empty section-break paragraphs

The original OPC/XML generator is `tools/canvas_empty_section_boundary_fixture.py`.
Eleven small-page cases isolate empty versus text/space-bearing section breaks,
paragraph borders, shading, page-break-before, ample room and numbered boundaries.
The fixture uses installed Arial; no font is bundled. `native.pdf` was exported
from the exact source in the reference application without saving. `reference.json`
binds its twenty-four page texts to the source SHA-256.

ECMA-376 Part 1 §17.6.18 places a nonfinal section's properties on its last
paragraph; §17.6.22 defines the following-page transition. The reference application treats an empty
paragraph carrying that section break as a boundary rather than another body
line. It suppresses that paragraph's spacing, borders, shading and
page-break-before even when room remains. A numbered empty boundary produces
no marker and does not increment the list: the following item starts at 1.
Paragraphs containing actual text or spaces retain their layout and can spill
onto an additional page. These are observed reference compatibility rules beyond
the general paragraph-formatting behavior described by the standard.

Before the fix, the original seven cases occupied twenty browser pages instead
of the reference application's sixteen. The expanded eleven-case reference occupies twenty-four
reference pages. Unit tests compare every labeled paragraph's page, suppressed paint,
numbering, bounded insertion carets and immutable source formatting. The browser
checks page counts, absence of red decorations, boundary typing, export/reopen,
unchanged unrelated parts and exact ZIP-entry undo. Typing at the first empty
boundary makes it a real text paragraph and adds one page; undo restores the
original pagination without removing the source paragraph or section properties.
The edited browser export was also opened in the reference application: its twenty-five page texts
match the reference with only the inserted boundary text/page added.

The virtual insertion line is kept inside the page's writing area. This does
not extend support to continuous/column/parity transitions in later sections,
which retain their existing import guards.
