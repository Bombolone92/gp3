# Floating-table native references

`tools/floating_table_fixture.py` authors twenty original controls using
python-docx and direct OOXML. No corpus content or font binary is included.
The source specifies compatibility mode 15, Arial 12pt, exact 15pt lines,
Letter paper, one-inch margins, and a 144pt by 72pt red table with zero cell
margins. Additional controls vary width to 72/288pt and anchor font to 18pt.
The reference application opened the source read-only and exported `native.pdf`
without saving it. All eight source XML schema checks pass.

`cases.json` lists authored positioning attributes. `reference.json`
binds the source and native PDF by SHA-256. The independent recorder measures
red table ink at four pixels per point and the PDF glyph bounds of three
paragraph labels. Coordinates are points from the page top-left. Pixel bounds
include raster rounding and are not exact table border centerlines.

Controls cover inline flow; explicit page/margin/text positioning; negative
and positive paragraph offsets; wrap distances; center/right/bottom alignment;
omitted anchors; and the interaction of text anchors with `tblpYSpec`.

ECMA-376 Part 1 §17.4.57 says omitted horizontal and vertical anchors default
to page. The reference application instead uses the margins: 144pt offsets give (216,216), identical
to explicit margin anchors. Omitting only the horizontal anchor gives
(216,144); omitting only the vertical anchor gives (144,216). Explicit page
anchors give (144,144). These paired controls establish a consumer divergence.

The same clause says relative vertical alignment is ignored for `vertAnchor`
text. The reference application places `tblpY=240` at y=114pt without `tblpYSpec`, but near y=102pt
with `tblpYSpec=center`. This is a second observed compatibility difference.
PDF rectangle vectors place the latter at y=101.66pt; both 12pt and 18pt
anchor fonts support the reference application's minus-seven-twip fallback offset.

The paragraph anchor shares the next ordinary paragraph's line-box top at
y=102pt; the inline baseline instead advances that paragraph by 72pt. The reference application
wraps text beside the floating table and resumes full width below it. Modern
center/right placement aligns a frame twelve twips wider than the table grid;
the 72/144/288pt controls distinguish this from proportional scaling. Horizontal
wrapping uses at least 24 twips clearance, otherwise the authored distance plus
15 twips, as established by the 0/2/18pt distance controls. These measured
compatibility adjustments are not attributed to the OOXML specification.

The browser regression checks all twenty table rectangles within 0.4pt of
independently sampled native reference ink, plus anchor origins and side-wrap clearance.
It clicks and edits a floating cell, preserves source positioning and unrelated
package parts, restores exact undo and reopens the edited document. Unit checks
cover alignment/indent commands and full-width negative-offset convergence.
Single-page body floats now render; multi-page and nested floats remain guarded.
Overlap rules, border-dependent frame geometry, story interactions and other
positioning edge cases need additional controls as implementation proceeds.
