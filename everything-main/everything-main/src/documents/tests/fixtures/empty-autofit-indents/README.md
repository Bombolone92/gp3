# Empty paragraph indents in AutoFit cells

`tools/empty_autofit_indents_fixture.py` authors original OPC/XML. The
reference application exported the ten-page PDF read-only. The independent recorder
captures shaded center-cell bounds at four pixels per point and source/PDF
hashes. All ten native/app control pairs were visually inspected.

The center cell has a 10pt preferred width and 2pt left/right padding. Controls
vary empty paragraphs with 27pt left, right, first-line, hanging or combined
indents, then retain actual space, tab, line-break or visible-text content.
The reference application keeps all six empty controls at 10pt. Before this correction the app
expanded the single-indent cases to roughly 32pt and the combined case to 59pt.
The app now excludes a genuinely empty paragraph's indents from intrinsic cell
widths. Literal spaces and breaks still count; an empty numbered/bulleted item
with a visible marker still contributes its marker geometry. Saved paragraph
formatting is not changed. Cell padding and preferred widths remain in effect.

The tab case exposes an independent existing AutoFit gap (native reference approximately
58pt, app 32pt). It is retained visibly and in the reference but is not certified
by this fix's native-width assertion. Nine other controls compare both horizontal
edges within 0.6pt, including existing raster and minimum-width differences.
Editing, undo, export/reopen, source declarations and untouched package parts
are checked. This is not complete AutoFit certification.

ECMA-376 Part 1 §§17.18.87 (`ST_TblLayoutType`), 17.3.1.12 (`ind`), 17.4.68
(`tcMar`) and 17.4.71 (`tcW`) govern content widths, indentation and preferences.
The standard gives latitude in the AutoFit algorithm and does not prescribe
empty-paragraph width demand; this records the reference application's observed behavior, not a
claimed explicit normative contradiction. No fonts or external code are added.

## Tab demand correction, September 27, 2026

The previously excluded tab case now matches the reference application's 58pt width and is included
in the existing native-edge assertion at its unchanged tolerance. The generic
intrinsic-width correction and 195 additional native cases are documented in
`../autofit-tab-minimum/README.md`. This also removes the extra writing reserve
after nonempty paragraph indentation (the space and break controls are 31pt in
the reference application). Saved formatting, painted tab placement and package contents are unchanged.
