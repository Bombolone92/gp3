An independently authored one-page control with 60 empty floating tables.
Each row advances the Y phase by one twip, covering all fifteen phases in a
96-DPI pixel. Four columns independently vary X by 0, 4, 8 and 12 twips.
Borders are single black 0.25-point lines. No pictures or font programs are
embedded. `tools/border_axis_phase_fixture.py --dense` reproduces the source.

The native reference screenshot was observed at 100% zoom. The exact
owned source remained saved before and after capture and was closed without
saving. Its post-close bytes match this original. The recorder binds that
source, capture metadata, measured ink, and read-only page metafile by SHA-256.
Run `tools/record_border_dense_phase.py CAPTURE_DIRECTORY` to reproduce the
reference. The private capture directory contains `capture.json`, `cases.json`,
`native-100.jpg`, `page.emf`, and `border-dense-phase-owned-20261002.docx`.

At phase 8, the reference application paints the leading horizontal edge at 152, while ordinary
nearest rounding predicts 153. At phase 9 it paints at 169, while the prior
preceding-600-DPI formula predicts 168. Both counterexamples occur at every X
phase. A 0.08-pixel leading bias fits these 60 tops but remains an unproven
empirical hypothesis. A trailing-edge minimum-width rule predicts exclusive
bottom 145 for phase 7, whereas the reference application gives 144. These controls reject those
universal formulas; they do not prescribe a production correction.

The paper PNG retains native caret/table handles. Cross-sections avoid these
and border junctions. JPEG-derived pixels are classified at threshold 128;
no full RGB equivalence is claimed. The 720
PATCOPY metafile rectangles describe print geometry, not display pixels.

`reference-200.json` records a second native observation at 200% zoom.
The source remained saved and its post-close bytes still match the original.
Two viewports are retained without compositing: top origin [80,213], bottom
origin [80,-97], derived from the inclusive 768-by-576 paper outline. All
16,852 non-outline pixels in their shared 22-row band agree at threshold 128.
Sixty full frame cross-sections are measured across the two crops. Run
`tools/record_border_dense_zoom.py CAPTURE_DIRECTORY` to reproduce four files
from `capture-200.json` and `native-200-{top,bottom}.jpg`.

At 200% the native first frame has top [48,49), bottom [64,65). Applying the
100% biased-bottom-minus-one rule gives bottom [63,64), disproving that rule
across zooms. Preserving ordinary nearest-rounded bottoms also fails: phase
4 native bottom is [192,193), versus predicted [193,194). An empirical floor
of the authored trailing boundary fits these 200% bottoms; it does not fit
the 100% capture and is not a production rendering rule.

`native-table-metadata-reference.json` binds a follow-up read-only native COM
capture of `Rows.HorizontalPosition`, `VerticalPosition`, `Height`,
`HeightRule` and `WrapAroundText`. All sixty getters report positions one
twip before their authored coordinates while retaining exact six-point row
heights. This is not proof of visual border positions or a rendering rule.
`tools/record_border_table_metadata.py CAPTURE_DIRECTORY` reproduces the two
JSON files from `table-metadata.json` and the unchanged owned source.

`reference-175.json` adds native 175% observations. The inclusive paper
outline gives top origin [128,209] and bottom origin [128,8] for a 672-by-504
page. All 87,770 non-outline pixels in the shared 131-row band agree at
threshold 128. The unchanged owned source was closed without saving; native
saved state, zoom, page geometry and post-close source hash are checked.
Use `record_border_dense_zoom.py CAPTURE_DIRECTORY --zoom 175` to reproduce
the four artifacts. Its default 200% artifacts remain byte-identical.

At phase 14, native leading Y 436 rejects continuous 0.08-pixel bias (435).
At phase 5, native Y 182 rejects the preceding-1200-DPI grid (183). Both
counterexamples occur at every X phase. A continuous one-twip bias matches all
sixty tops at 175%, but a general border correction remains unproven. Bottom
edges, shared ownership, fill clipping and other thicknesses remain essential.
