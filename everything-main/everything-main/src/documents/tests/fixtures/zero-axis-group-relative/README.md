# Percentage sizing of zero-axis groups

`tools/zero_axis_group_relative_fixture.py` independently authors six anchored
groups with 25% page-relative widths, heights or both. Each child has a 12 pt
offset on the saved zero axis, making accidental expansion visible.

The reference application confirms the exact source, opens read-only, repaginates
and exports one page. `tools/record_zero_axis_groups.py zero-axis-group-relative`
records the actual PDF strokes and source/reference hashes. All pens remain
2 pt. Increasing the nonzero axis length gives 198 pt vertical or 153 pt
horizontal lines. Percentage expansion of the zero axis does not expand its
artwork or restore the child's 12 pt offset.

A separate read-only native reference Shapes query records these outer Width/Height
pairs, in points and case order: (0,198), (153,0), (153,72), (72,198),
(153,198), (153,198). Thus the outer selection frame can gain area even while
the artwork stays collapsed. Unit/browser tests check these frames and selecting
their unused area, as well as native strokes and edit/export/undo/reopen.
