# Independent table-axis phases and exact-height metafile geometry

`tools/border_axis_phase_fixture.py` manually authors deterministic OPC/XML,
with no corpus content, artwork, embedded fonts or image resources. Eight
pages cross border sizes 2 and 18 eighth-points with exact heights 473, 479,
481 and 487 twips. Each page has sixteen 48pt-wide floating tables: horizontal
and vertical phases vary independently through 0, 4, 8 and 12 twips. Absolute
positions, empty one-point paragraphs and compatibility mode 15 are explicit.

The reference-opening helper confirmed the exact owned scratch copy. The
reference application captured eight `Page.EnhMetaFileBits` values read-only, with source
hash unchanged and Saved true. `native-capture.json` retains that provenance.
Compressed metafiles retain the original bytes and contain ordinary GDI border
records and font metadata, not embedded font programs. The recorder accepts
only source-free PATCOPY rectangle records, rejecting bitmap source data and
unexpected world transforms. The native window extent is 2400x1800 for a
288x216pt page, a 600 DPI reference-coordinate grid.

Each table supplies twelve overlapping/joining black rectangles. The record
contains all 1,536 rectangles and 128 resulting bounds. At fixed row position,
changing only x phase changes none of the 32 native top/bottom extent pairs.
For these controls, all bottoms satisfy:

```
floor((2*yTwips + 2*heightTwips + 5*borderSize) * 5 / 24)
```

This floors the entire position-plus-height-plus-border expression in native
reference coordinates. There are 20 exact lattice boundaries: selecting the
previous lattice point there fails every one. Separately flooring all three
components matches only 44/128; flooring origin and combined extent separately
matches 96/128; flooring position/height before adding floored border matches
64/128. These are isolated metafile geometry observations, not a shipped rule.

The native bounds do **not** identify screen painting. Eight tables have the
same declarations as individual older exact-height screen controls. Nominal
nearest-device projection matches 14/16 zoom observations, with two one-pixel
bottom failures at 100%. The surrounding table/page content differs.
`reference.json` binds the older screen record
and retains both counterexamples. Direct GDI+ downsampling of these new page
metafiles can omit subpixel thin sides; private playback images were inspected
but are not treated as reference screen oracles. Do not replace the existing
minimum-width painter or infer a screen fix from a metafile projection.

`screen-reference.json` now records live reference application captures of all eight pages at
100% zoom. Thumbnail selection identifies pages; the gray paper outline
identifies page origins independently of table ink. Pages 5–7 were scrolled
sixteen pixels to clear the ribbon. Original JPEG captures remain private;
the published PNGs are lossless crops of their decoded neutral table regions.
The fixed threshold is 128, matching the earlier controls. All eight shared
100% table geometries reproduce the older bounds exactly, including the two
disputed bottoms. Nominal nearest projection of native metafile bounds matches
48 left, 128 top, 96 right and 104 bottom edges out of 128 each. Changing x
phase changes no vertical screen bounds within a row. The browser independently
recomputes every recorded frame from the PNG pixels. These results reject the
projection rule; they do not assert current viewer agreement or a replacement rule.

The source hash and empty text were rechecked after the 100% capture. The reference application displayed
Saved during every capture, and the first metadata read returned Saved true.
Its subsequent `ComputeStatistics(2)` pagination query changed the scratch
Saved flag to false. The record preserves this distinction; no changed scratch
package was saved or used as a reference. No font programs or application artwork
are present in the published controls/crops.

`screen-reference-200.json` adds eight clean live captures at 200%, with the
paper top outline visible at y=197 (thin pages) or y=192 (wide pages), x=422.
The insertion point is outside the tables and the pointer is in Navigation;
move/resize handles and pointer highlights are absent from the final matrix
crops. Preliminary captures with those overlays were rejected by the neutral
pixel/row-invariance checks and replaced, without changing thresholds or
masking pixels. The reference application remains Saved true after capture; eight sections, empty
text and unchanged source hash are verified without a pagination query.

The 200% bounds reproduce all eight older matched declarations. Absolute
nearest metafile projection matches 32 left, 96 top, 48 right and 116 bottom
edges out of 128. Across both zooms, leading positions match nearest projection
of the strictly preceding 600-DPI reference point of the authored table origin,
with minimum-width compensation for subpixel vertical borders. At exact ties,
that differs from metafile geometry's proven floor. This establishes separate
capture/display stages, not a renderer implementation. Projecting metafile
endpoints relative to a rounded table origin still fails: floor-origin models
match 120/128 bottoms at 100% and 92/128 at 200%; preceding-origin models match
104/128 and 116/128. Both also acquire trailing-width failures at 200%.

The viewer opens eight editable pages and retains all 128 cells. The browser
test verifies no-edit package equality, insertion, unrelated-part preservation,
exact undo and edited reopening, and writes current pages/layout for review.
This test does not assert pixel equality with the native reference. Ten unit tests independently
parse every native rectangle, bind all hashes and inspect source declarations.
Source and three browser exports pass twelve schema views.

Relevant declarations are ECMA-376 Part 1 §§17.4.38 (`tblBorders`), 17.4.57
(`tblpPr`), 17.4.80 (`trHeight`) and common border properties in §17.3.4.
No normative 600 DPI raster algorithm or reference/spec divergence is established.
The planner #226 border discrepancy remains open; no document-specific
constant, runtime change or completion promotion is introduced.

Reproduce from the repository with its installed dependencies and unchanged
Vite at `0.0.0.0:5173`:

```
python tools/border_axis_phase_fixture.py --output <fresh-folder>
```

Use the documented reference-opening helper on an owned scratch copy, then run
`tools/capture_docx_page_metafiles.ps1` with that exact source/hash,
`ExpectedPages=8`, `WidthPt=288`, `HeightPt=216` and a fresh capture directory.

```
python tools/record_border_axis_phase.py <capture-directory> --output <fresh-folder>
npx vitest run tests/border-axis-phase.test.js
```

To reproduce the live-screen record from the original private captures and
their `screen-state.json` metadata:

```
python tools/record_border_axis_screen.py <screen-capture-directory> --output <fresh-folder>
python tools/record_border_axis_screen.py <screen-capture-directory> --zoom 200 --output <fresh-folder>
```

The normal browser regression is `tests/browser/border-axis-phase.spec.js`.
No fresh server, reference application installation, dependency or hosted check is needed.

`screen-body-bands.json` records 1,024 straight-body bands from these same
native PNGs, independently of outer corner bounds. Eight-pixel cross-sections
are positioned from authored coordinates, exclude caps and use median RGB
profiles at the existing threshold 128. At 100%, 2.25pt top/vertical bodies
are three pixels, while bottom bodies are two or three pixels; at 200% all
are six pixels. Quarter-point bodies are one pixel at both zooms. No constant
wide-bottom pen can reproduce these measurements. Current viewer agreement is
not asserted. Reproduce with `python tools/record_native_table_bands.py`,
`npx vitest run tests/native-table-body-bands.test.js`, and the independent
pixel extraction in `tests/browser/native-table-body-bands.spec.js`.
