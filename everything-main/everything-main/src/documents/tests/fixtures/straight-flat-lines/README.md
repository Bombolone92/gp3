# Straight connector preset: standalone native controls

`tools/straight_connector_fixture.py` derives eight independently authored
controls from our flat-line fixture, replacing the preset with
`straightConnector1` and reflecting alternating cases horizontally. No corpus
content is included. The reference application opened the file read-only and exported the
eight-page `native.pdf`. `tools/record_flat_lines.py straight-flat-lines` records
native red ink bounds at 0.25pt resolution, with source/PDF hashes.

Cases cover horizontal/vertical lines, positive/negative rotations, doubled
frame dimensions and inline placement. Browser tests compare all native bounds,
exercise pointer selection, and verify surrounding edits, unrelated-part
preservation, exact undo and editable export/reopen. The original line and
relative-line controls remain in the same regression run.

ECMA-376's supplied `presetShapeDefinitions.xml` defines straightConnector1
as an unfilled path from (l,t) to (r,b). A zero frame axis is permitted by
ST_PositiveCoordinate. The unit path representation preserves that geometry
without division by zero and retains physical stroke width. No standards
divergence was observed. Point-sized lines, malformed dimensions and unsupported
adjustments remain guarded; the original XML retains its preset spelling.

Oval markers are independently recorded in `../straight-oval-lines/` and
`../oval-markers/`. This fixture covers the underlying unmarked preset.
