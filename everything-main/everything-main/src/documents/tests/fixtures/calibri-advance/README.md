# Independent size and tracking control

`tools/calibri_advance_fixture.py` authors this deterministic OOXML package
without the application serializer or corpus content. Eight twelve-letter
rows isolate Calibri regular/bold at 10/36 points with zero/one-point
`w:spacing`; `w:kern` is explicitly zero. Relevant ECMA-376 Part 1 clauses
are §17.3.2.19 (kern), §17.3.2.35 (spacing), and §17.3.2.38 (sz).

`native-carets.json` contains repeated numeric caret observations from the
exact, already-open, visible, saved reference control. The source hash and window
guards passed before and after. Screen positions have 0.75-point resolution.
All browser character starts differ by at most 0.375 points; the browser
regression also checks end carets, editing, exact no-edit/undo export,
unrelated-part retention and edited reopening. The native comparison requires
the same installed Calibri face; it does not grant font-access permission.

`native-print-origins.json` records numeric origins from a fresh private native reference
PDF export. Extraction uses explicit text operators, declared widths and
Unicode metadata with embedded font programs disabled. Neither the PDF nor
font assets are distributed. All eight rows/96 characters pair exactly.
The maximum browser/PDF difference is 0.421431 points horizontally and
0.120092 points vertically. These are measurements, not exact print equivalence.

The average exported per-letter advance for the 36-point bold row changes
from 17.554909 to 18.523636 points with one-point tracking, an observed
0.968727-point increment. Regular 36-point and both 10-point rows differ.
This does not prove an OOXML divergence or justify globally rounding font
size, substituting a font, or changing tracking. The originating cover-letter
review remains partial: its full heading has a larger horizontal discrepancy,
and the control has not established the generic cause. Renderer code is
unchanged in this evidence commit.
