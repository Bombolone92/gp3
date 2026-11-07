# AutoFit width preferences and indivisible pictures

`tools/autofit_picture_preferences_fixture.py` authors eight original controls
from the repository's original modern AutoFit picture fixture. Each page has
the same centered one-cell table, green borders, 115-twip side margins and
four-inch writing area. The picture is either 504 or 280 points wide. The only
other variable is the table width preference: automatic, 288-point absolute,
100-percent, or omitted. The picture's inner transform and inline frame have
matching dimensions, avoiding the parent fixture's unrelated aspect mismatch.
No corpus artwork is included.

The reference application opened the exact file read-only and exported eight
pages. `record_autofit_picture_preferences.py` measures green border centerlines
from PDF paths; `reference.json` binds source, case and PDF hashes. Both
automatic and omitted widths, and the percentage width, produce approximately
287.102-point tables. The absolute preference expands to 515.620 or 291.560
points for the large or small picture. Oversized content retains its natural
dimensions and is clipped at the constrained cell boundary.

This refines the mode-15 behavior in the original `table-unbreakable` controls:
their absolute preferred widths do not establish that every AutoFit table may
expand past its width limit. ECMA-376 Part 1 §17.18.87 supplies AutoFit layout
guidance; this is independently observed reference behavior, not a claimed explicit
contradiction of a mandated overflow algorithm. Source widths and media remain
unchanged by layout.

The unit regression initially failed all six automatic/percentage/omitted
cases. Tests compare all eight native table widths and origins within 0.2pt,
retain natural image widths and clipping, change an automatic width to an
absolute preference, export, and restore the exact original package on undo.
Browser checks cover painted overflow, all eight pages, no-edit retention,
ordinary editing, unrelated parts, exact undo and edited reopening. These
checks do not certify arbitrary table configurations or exact image sampling.
