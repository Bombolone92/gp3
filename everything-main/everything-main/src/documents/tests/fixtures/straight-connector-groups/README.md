# Straight connectors inside groups

`tools/straight_connector_fixture.py` derives twelve controls from our manually
authored zero-axis group fixture, changing only the line preset to
straightConnector1. The source is `public/fixtures/straight-connector-groups.docx`.
The reference application exported the one-page native PDF without saving the source.
`tools/record_zero_axis_groups.py straight-connector-groups` records native PDF
endpoints and physical pen widths, including the source/PDF hashes.

Coverage includes horizontal/vertical, doubled dimensions, zero child extents,
collapsed display extents, child offsets, nested groups and group rotation.
Browser checks compare every endpoint within .015pt, physical stroke width,
visible/degenerate ink, pointer selection, exact undo pixels, editable reopening
and package preservation. Original group fixtures remain in the regression run.
No corpus artwork, font binary or third-party renderer is included.
