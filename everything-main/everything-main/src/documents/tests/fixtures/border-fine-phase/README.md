# Thin-border rounding boundary

`control.docx` is original, manually authored OOXML from
`tools/border_fine_phase_fixture.py`. It contains 17 empty floating 1×1 tables,
with 0.25pt single black borders, zero cell margins and exact 60pt row heights.
There are no pictures, embedded fonts, text glyphs or borrowed template parts.
The page is 288×432pt with zero margins and compatibility mode 15.

The anchors sweep Y=301…317 twips. Successive groups of four are displaced by
1500 twips (100 screen pixels), preserving the fractional phase while keeping
the tables separate. X anchors are 360, 1680, 3000 and 4320 twips. Each table is
960 twips wide. `cases.json` retains the full absolute positions.

The reference application was opened through the reference-opening helper, then through the normal
visible Open UI after the helper chose an invisible instance. Computer Use set
the owned document to 100% zoom. Read-only COM capture verified an empty document,
17 tables, one 288×432pt page and Saved before/after the page-metafile capture.
Only the exact unchanged owned scratch was closed, without saving. Source bytes
match the authored control. Other reference application documents and instances were preserved.

The visible paper outline independently establishes screen origin (439,194):
left outline at (439,204), top at (450,194), right at (822,200), white paper just
inside. The page bottom is clipped by the window, but all 17 table crops are
fully visible. Cross-sections avoid the first table's UI handles and caret.

After subtracting the integer group displacement, all eight anchors at
301…308 twips have top ink `[20,21)` and bottom ink `[99,100)`. All nine at
309…317 have top `[21,22)` and bottom `[100,101)`. Vertical rules consistently
begin one pixel left of the authored integer X, and are 64 pixels apart.
The preceding-grid candidate predicts top=20 at 309 and is therefore rejected
even for an isolated cell. A nearest-grid fit to this sweep alone is insufficient
evidence for a replacement: prior independent controls and connected border/fill
regressions must still pass.

`reference.json` binds source, cases, capture metadata, the compressed page
metafile, and 17 actual native PNG crops by SHA-256. The metafile contains 204
PATCOPY rectangles and no bitmap records or world transforms. Its 600-DPI page
geometry is a separate reference from the observed screen pixels. There is no
full RGB/page-equivalence claim and no runtime renderer change or corpus promotion.

Relevant declarations: ECMA-376 Part 1 §§17.4.38 (`tblBorders`), 17.4.57
(`tblpPr`), 17.4.80 (`trHeight`) and §17.3.4 (common border properties).
These clauses do not establish a normative screen raster grid. No reference/spec
divergence is claimed.

Reproduce the source with `python tools/border_fine_phase_fixture.py --output
<fresh-directory>`. Open an owned copy with the documented reference-opening helper, use
Computer Use to observe the correct document and set 100% zoom, and retain the
native screenshot as a reference artifact. Capture `EnhMetaFileBits` through
read-only COM with exact-path, source-hash, Saved, empty-content, table-count and
page-geometry guards. Close only the unchanged owned scratch without saving.
`python tools/record_border_fine_phase.py <capture-directory> --output
<fixture-directory>` checks those guards and records the crops. A fresh capture
with different window geometry requires independently observed paper coordinates;
do not reuse this capture's origin blindly.

Browser tests independently decode every native crop and verify the boundary,
then exercise the real import, painting of all 17 tables and exact package-part
preservation. Current renderer cross-sections are written as diagnostics, without
freezing incorrect pixels as expected behavior.
