# Rotations inside zero-axis groups: native evidence

`tools/zero_axis_group_rotation_fixture.py` authors twelve additional controls
from the independently authored horizontal/vertical zero-axis fixture. It adds
45/90-degree child line rotations, nested 90-degree group rotations, and root
horizontal/vertical reflections. Four further controls combine reflections with
30-degree child/nested-group rotation below a truly singular ancestor scale.
No corpus artwork or third-party engine is used.

The reference application confirmed the exact source path, opened the source
read-only, repaginated and exported this one-page PDF. The full native page was
visually inspected. All five XML schema checks pass. Source/PDF hashes and the
actual native line endpoints are retained in `reference.json`; regenerate
the record with `tools/record_zero_axis_groups.py zero-axis-group-rotations`.

The reference application retains the 72-point line length after rotating either the child or its
nested group despite an ancestor's zero displayed/child-coordinate axis. The
45-degree controls retain the corresponding diagonal. All pens are 2 pt.
The final four cases require retaining reflection handedness after a matrix
column collapses: reconstructing a positive-handed perpendicular reverses the
native horizontal/vertical components by 36 pt. Geometry and relative controls
are recorded separately in the adjacent zero-axis fixture directories.

The browser regression compares actual transformed line endpoints/physical pens
against the PDF, verifies visible ink, and exercises editable import, unchanged
package export, surrounding insertion, exact undo and editable reopening.
