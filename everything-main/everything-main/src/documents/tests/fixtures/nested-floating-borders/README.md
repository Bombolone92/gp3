# Border-dependent nested floating alignment

`tools/nested_floating_borders_fixture.py` authors twenty original controls in
Arial, compatibility mode 14. Each outer table has two 3-inch cells. The left
contains an inline two-row table as an independent positioning control; the
right contains a 1-inch floating table with a 36pt paragraph-relative vertical
offset. `cases.json` identifies the border side, eighth-point width, owning row,
and horizontal alignment (omitted means center). No corpus artwork is included.

The reference application opened the exact source read-only and exported twenty
pages. `manifest.json` binds the source, cases, native PDF and coordinate data.
`reference.json` records native PDFium text origins and green shading
rectangles taken from the PDF paint operations, including saved/restored color
state. Nested writing-area fills contained within a cell fill are deduplicated.
Coordinates are points from the upper-left of each page.

The zero-border nested text begins at x=359.710pt. A 3pt right border moves it
left to 359.350pt whether that border is in the first or second row. A 6pt right
border moves it to 358.630pt. A 3pt first-row left border instead moves it right
to 360.430pt; the same border only in the second row leaves the frame unchanged.
Both first-row borders give 360.070pt. The 1pt and 1.5pt right-border cases do
not displace the frame; a 2pt right border moves it by 0.120pt. Left/right/numeric
position controls separate alignment-frame expansion from a fixed translation.

These observations support first-row left half-border overhang and the largest
right half-border over all rows. The existing right frame reserves 15 twips;
only ink beyond that extends the alignment width. ECMA-376 Part 1 §17.4.57
specifies relative alignment against the entire frame without prescribing this
border-dependent construction. The implementation retains the original border
and position XML and derives geometry from resolved borders. It does not use
template identities, preferred widths or corpus-specific constants.

The legacy outer table's existing horizontal offset remains separate: browser
tests compare X against the left inline control, absolute Y against the reference application, and
the actual painted shading edges. Native relative text origins match within
0.05pt. Unit tests exercise border editing, later-row behavior, export/reopen,
undo and redo. This does not certify all floating-table overlap, pagination or
compatibility modes.

Validation: 78 unit tests across border editing, nested floating placement,
existing cell borders and clipping; 30 browser regressions, including all twenty
native border cases, shading, text edits and retained border export; 32 schema
checks across the fixture and its no-edit/edited/undo browser exports; production
build and dependency-license policy. The complete twenty-page native reference
was visually inspected as well as measured.
