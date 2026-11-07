# Oval end markers: standalone native evidence

These eight independent controls add an oval tail marker to the standalone
straight-connector controls. The reference application exported eight pages; native ink
bounds and hashes are recorded by `tools/record_flat_lines.py straight-oval-lines`.
The default marker is 6pt across on a 2pt stroke. Reflections, rotations, doubled
frames and inline placement are included. The XML generator is
`tools/straight_connector_fixture.py`.

The importer now retains these ovals through editable import and export. The
flat-lines browser suite compares their native ink bounds, pointer selection,
package preservation, edits, exact undo and reopening. Additional native sizing,
curve direction, group, transparency and dash controls live in ../oval-markers.
Other line-end types remain unsupported; this evidence establishes oval ends.
