# Zero-extent custom paths: native reference

`tools/flat_custom_shape_fixture.py` independently authors twelve custom-path
controls inside ordinary 100 pt groups. No corpus geometry is copied. The controls
cross horizontal, vertical and both-zero shape extents with omitted/explicit path
coordinate dimensions and absent/2 pt round-capped outlines. The same cubic path
deliberately leaves the zero frame when its coordinates are absolute.

The reference application opened the exact source and exported the retained one-page PDF;
the entire page was inspected. With one zero extent, omitted path dimensions
retain the absolute-coordinate filled geometry. Explicit dimensions collapse it;
an outline remains visible but the fill does not. Both-zero shapes paint no ink,
including the omitted-dimension variants. This rules out treating every flat
custom shape as invisible. Native bounds, absent ink and source/reference hashes
are recorded by `tools/record_flat_custom_shapes.py`.

The production importer retains these paths, including zero-valued guide inputs.
The browser regression compares all twelve native ink bounds/absences and verifies
editable load, package preservation, undo and edited reopening. See the sibling
`flat-custom-standalone` fixture for the same paths outside drawing groups.
