# Cell border `none` controls

Original OOXML authored by `tools/cell_border_none_fixture.py`, using python-docx
(MIT), lxml (BSD) and the standard library. No corpus content or font binaries
are included. `cell_border_none_reference.py` records the native reference text origins
and red/blue ink bounds, binding each reference to document/styles XML hashes.
The eight sources pass the official transitional schema checks.

- `matrix`: zero/nonzero width and automatic/explicit color on direct cell sides.
- `edges`: omitted/default attributes, spacing, frame, shadow and theme color.
- `style`: first-row blue borders and last-row `none`, without direct cell borders.
- `spacing`: `none` versus `nil`, independent cell margins and border spacing.
- `spacing-rules`: exact height, unequal cell margins/spaces, two shared rows,
  nested tables, a standalone conditional `none` style and bottom-only spacing.
- `style-only`: default and nondefault `none` in a standalone first-row style.
- `priority`: crossed first/last-row and first-column/first-row borders.
- `properties`: the priority cases with independent bold/italic and shading
  declarations, distinguishing excluded regions from reversed application order.

The applicable ECMA-376 Part 1 clauses are 17.4.66 (`tcBorders`), 17.4.38
(`tblBorders`), 17.3.4 (common border properties), 17.18.2 (`ST_Border`) and
17.7.6 (table styles). The observed reference compatibility rules depend on more
than the `none` enumeration alone: a direct declaration with zero/omitted size,
automatic/omitted color, zero spacing and false frame/shadow clears the inherited
cell border and exposes the table border. Nondefault declarations suppress ink.
`nil` suppresses ink and ignores spacing; `none` can reserve space without ink.
Shared rows reserve one shared boundary. Horizontal writing insets reserve half
the invisible spacing, and vertical layout follows the same shared-boundary
geometry as a visible border. Original declarations survive unrelated edits.

The controls demonstrate that nondefault conditional `none` suppresses outer
ink too. The first/last-row overlap preserves only first-row properties in
the reference application, including run formatting and shading. This differs from simply applying
both regions in the sequential order in Part 1 §17.7.6.6. The independent
first-column/first-row cases still merge their run properties.

The blue perimeter in `priority` and `properties` is 2 pt wide; the interior red
divider is 6 pt. The reference application keeps the horizontal perimeter continuous at both T
junctions and stops the divider at its inside edge. Native ink bounds and
editable export checks cover both ends, in addition to text origins.

All eight browser controls pass native ink bounds, text origins and editable
export checks. Existing indentation, continuation, corner, crossing and device
pixel regressions also pass. These controls do not prove complete conditional-style support. Page-cut,
repeated-header and mixed visible/no-ink-spacing edges still need independent
native controls. Separate alignment probes also retain a right-aligned
legacy-table position discrepancy; do not claim it fixed here.

The original scratch probes had `tblBorders` after `tblLook`. The committed-path
generator corrects that ordering, and those five native references were regenerated
from the schema-valid sources. The hash recorder checks every `word/` package
part before accepting a reference.
