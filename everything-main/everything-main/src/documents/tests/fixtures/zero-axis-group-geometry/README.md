# Zero-axis child geometry and coordinates

The independently authored `tools/zero_axis_group_geometry_fixture.py` crosses
zero/nonzero child-coordinate widths, zero/nonzero child line widths, and
0/45/90-degree rotations inside zero-width groups. Two unrotated cases also
exercise a reflected line and a reflected nested group under a singular scale.

The reference application opens the exact source read-only and exports the native
one-page PDF. `tools/record_zero_axis_groups.py zero-axis-group-geometry` records
its actual colored stroke endpoints and 2 pt pen widths, with source/PDF hashes.

The reference application first collapses child positions and widths on the zero group axis. A zero
child-coordinate extent then uses unit scale, so the zero-width line still
rotates into a diagonal/horizontal line. A nonzero child-coordinate width instead
provides a zero scale on that axis; at 45/90 degrees the tested line collapses
to a point instead of a finite rotated segment. Reflection translation
still operates on the surviving axis. Browser tests distinguish visible lines
from genuinely degenerate segments and preserve the imported source scenes.
