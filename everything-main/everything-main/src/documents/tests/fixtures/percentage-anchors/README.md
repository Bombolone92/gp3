# Percentage anchor positions (verification in progress)

`tools/percentage_anchor_fixture.py` authors these OPC/XML documents from our
original anchor fixture shell. Each document contains fourteen pages with one
72 by 36 pt blue picture per page. No corpus artwork or third-party font is
included. `body-native.pdf` and `cell-native.pdf` are reference exports.
`tools/record_percentage_anchors.py` records their image bounds and source/PDF
hashes in `reference.json`, independently of engine output.

Cases cover page, margin, column, paragraph, line, top/bottom margin references,
negative offsets, off-page frames, asymmetric effect extents, mixed numeric and
percentage axes, literal percent notation and an MCE choice with numeric fallback.
The page is 576 by 720 pt; margins are left 72, right 108, top 54 and bottom 90.
The cell is 240 pt wide with 10 pt padding. Effect extents are 5, 7, 11 and 13 pt.

Native observations:

- Body paragraph/line vertical percentages use the writing height, starting at
  the anchor paragraph/line origin. In the initial controls that origin happens
  to equal the physical top margin; the later header controls distinguish them.
- Cell page-relative X uses the whole cell width; margin/column X uses its
  content width. Vertical percentages use the cell content top regardless of
  percentage value. Numeric Y continues to apply its ordinary offset.
- Each percentage axis adds its own leading effect extent. A numeric axis does
  not acquire an effect offset merely because the other axis is percentage-based.
- `25%`/`50%` and `25000`/`50000` give equal positions. The reference application selects the wp14 MCE
  choice over the numeric zero fallback.

MS-ODRAWXML sections 2.19.1.1 and 2.19.1.2 define `wp14:pctPosHOffset` and
`wp14:pctPosVOffset` using DrawingML ST_Percentage. The cell/reference/effect
details above are empirical reference compatibility behavior; the extension's short
definitions do not spell them out. These controls alone do not prove behavior
in multiple columns, legacy compatibility modes or headers. Schema, browser
painting and broader regression verification remain pending.

Initial focused verification: `tests/percentage-anchors.test.js` and
`tests/canvas-anchor-position.test.js` pass together (32 tests). The new tests
check all 28 native positions, malformed values, no-edit package preservation,
body edits, unrelated-part preservation, edited export/reopening and exact undo.
The two new browser cases also pass: each page's blue image bounds match the
native PDF bounds within one pixel, including page-edge clipping, and editing,
export/reopen, unrelated-part preservation and exact undo pass. The two existing
relative-anchor-effects browser cases pass. The initial line-relative-anchors
regression timed out during playground navigation, before document loading;
its separate rerun passed with a 120-second test timeout (32.7 seconds elapsed).

Both source packages and all eight browser exports from these four passing
cases pass schema validation. The temporary schema cache now includes the
hash-pinned published wp14 schema and the percentage alternatives in CT_PosH/V.
Direct percentage positions are checked as extension content, not claimed to
have a standard-only fallback. Other optional wp14 metadata retains the existing
ignorable treatment. Native header/multicolumn controls, the original postcard
recheck, broader unit regressions and production build remain pending.

Follow-up: `tools/percentage_anchor_story_fixture.py` authors one-page header
and two-column controls; both native exports completed in the reference application.
The column images occur at (270,180) and (486,360) pt. The reference application applies the full
396 pt writing width starting at each column's left edge. The frame resolver
now matches that rule, but actual positioned drawing flow in columns remains
explicitly guarded as unsupported. The header image origins are (288,180),
(270,359.98001), and (270,471) pt; paragraph-relative header behavior still needs
investigation at that checkpoint.

The original postcard wraps entire position elements in MCE, unlike the first
fixture's wrapped position contents. Import now selects these branches during
anchor parsing and validates the selected inline properties. An edit/export/undo
regression covers this structure. All 38 tests across percentage anchors,
canvas anchor positions, line-relative anchors and relative anchor effects pass.
The postcard strict import now succeeds (11 paragraphs, six assets); its new full
browser review is in progress. Artwork differences observed in the prior preview
remain unresolved.

Header follow-up: `header-exact.docx` sets each header paragraph to exactly 18 pt.
The reference application produces origins (288,180), (270,351), (270,472.5) pt. This independently
confirms the reference rule: margin percentages use the header-expanded writing
span; paragraph percentages use that span's height starting at their paragraph
origin. The final exact-header browser capture matches all three painted bounds
exactly at 96 dpi, and its no-edit/edit/export/reopen/undo workflow passes.
Permanent browser regression and existing header-drawing regressions pass:
nine final browser cases total. All 15 resulting exports pass schema validation.
39 distinct focused unit tests pass, including an explicit guard against silently
discarding unrelated alternate properties. Final production build/license checks
and the original postcard workflow pass. The postcard's gift artwork remains
unresolved. Earlier pending statements above describe intermediate checkpoints.
