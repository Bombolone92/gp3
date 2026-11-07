# Native cubic range controls

`tools/svg_cubic_range_fixture.py OUTPUT_DIRECTORY` creates sixteen original
SVG groups in a deterministic DOCX. Eight heights bracket an observed native
sampling discontinuity. Each has one whole cubic and the same geometry split
at t=1/2 by de Casteljau subdivision. Coordinates are authored here; no corpus
artwork or font program is included. Licensing follows the repository.

The package reuses the independently authored step-change fixture's container;
only `word/media/vector.svg` differs. The SVG geometry follows the cubic
commands in [SVG 2 §9.3.6](https://www.w3.org/TR/SVG2/paths.html#PathDataCubicBezierCommands).
That section does not require a particular flattening algorithm or the reference application's
coverage grid. Whole/split raster differences are a numerical compatibility
target, not a demonstrated normative OOXML violation.

The exact scratch copy was opened with the reference-application document helper, then
captured read-only using `tools/capture_open_picture_metafile.ps1`. The source
hash and saved state remained unchanged. `tools/record_svg_group_cubic.py`'s
`record` function extracts sixteen PNG layers from the picture metafile,
rejecting unexpected object types including font descriptors. A second capture
has identical PNG hashes, dimensions and origins for all sixteen layers.

`tools/capture-cubic-flatten-sweep.ps1 -InputPath api-cases.json -OutputPath
native-api.json -QuantizeInput` supplies separate primitive API observations.
A second capture produces identical parsed data. Source, cases, capture and
native raster hashes are bound in `metafile-reference.json` and unit tests.

`node tools/compare-svg-cubic-range.mjs OUTPUT_JSON` compares native PNG RGBA with
the current renderer and with native API vertices substituted only in an
isolated browser context. The substitution matches all sixteen layers exactly;
production matches seven, with 4,100 differing alpha pixels across nine layers.
No reference lookup or new subdivision rule enters production. Each independent
group is evaluated separately to respect the unchanged aggregate raster budget.
Full-document editing/export checks exercise the actual bounded renderer and its
vector fallback as well.

The browser regression checks native layer dimensions/origins, source and host
immutability, editable import, no-edit package preservation, text insertion,
edited export/reopen, unrelated-part retention and exact undo. It records known
pixel residuals without requiring them to survive a future correction.
