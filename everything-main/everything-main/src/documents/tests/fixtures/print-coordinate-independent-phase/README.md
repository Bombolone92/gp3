# Independent local-extent coordinate holdout

`tools/print_section_phase_fixture.py coordinate-independent --output-folder
FRESH_DIRECTORY` authors 80 next-page Letter sections from original OOXML,
without consulting renderer output. Top margins 723, 1441, 4457 and 7753 twips
cross exact row heights 397, 401, 405 and 409 twips and five single-border widths
(3, 5, 8, 12 and 16 eighth-points). The table grid is 4320 twips; cell and story
margins are zero. There is no authored text or embedded font program.

Source SHA-256: `d4c17c774e7cba231b00830500b6a8f88fb19affc247e9df036aa5316e5b45c9`.

`frozen-predictions.json` was written before opening this source in the reference application. The
hypothesis keeps origin points in double precision, converts row and whole-twip
border reserve with float32 multiplication by float32 .05, adds those local
terms in float32, and rounds the completed far edge on the .12pt reference grid.
It matches the earlier 236 raw observations but fails fresh cases 13, 72 and 79.
It is rejected; these controls do not authorize a renderer change.

The exact private source was opened with the reference-application helper, then observed with
`capture_print_section_metafiles.ps1`. The reference application displayed Saved and 80
pages. Source hashes and Saved state were checked before/after read-only capture.
`record_print_metafile_rectangles.py` records twelve unclipped blue PATCOPY
rectangles per page, discarding text/font metadata and retaining numeric device
coordinates and source/metafile hashes. Original metafiles stay private.

Four read-only `Table.Range.EnhMetaFileBits` observations separately retain
numeric local rectangles in `native-table-range-rectangles.json`. Source/Saved/view
guards pass. Their rectangles exactly translate into the corresponding page
rectangles; this does not prove that the reference application independently rounds a local extent or
reflows the table when producing a range metafile. Cases 12 and 72 have identical
local ink at different page origins. No PDF or live-screen oracle is claimed.

Run `tools/check_print_local_extent_holdouts.py` and its Python tests to verify
the recorded guards, frozen predictions and counterexamples. The shared browser
roundtrip scenario checks all 80 pages, no-edit/undo package equality and edit
reopening. ECMA-376 Part 1 §§17.6.11, 17.4.80, 17.18.37, 17.4.38/66 and 17.3.4
define the authored dimensions and borders; they do not specify this consumer's
floating-point or printer-grid arithmetic. No specification divergence is proven.
