# Crossing-span writing floors and protected minima

Original project-generated OOXML controls, created by
`tools/autofit_span_floor_fixture.py`; no third-party document or font is bundled.
Arial must be installed for comparison. The generator creates six narrow-page
and eight wide-page cases, varying two/three-column spans, empty and nonempty
cells, margins, and fixed-width noWrap cells.

`narrow-native.json` and `wide-native.json` record direct reference Cell.Width measurements
from the reference application, after PDF export initializes print layout. They bind the
source and native PDF by SHA-256. Re-record with
`tools/record-native-cell-widths.ps1` after regenerating sources (ZIP timestamps may
change); do not update references from engine output.

ECMA-376 Part 1 17.18.87 permits alternative AutoFit algorithms; 17.4.17,
17.4.29, 17.4.68 and 17.4.71 cover grid spans, noWrap, margins and cell width.
The measured allocation is reference compatibility, not a normative formula or a
proven contradiction of the standard. Under merged content pressure, weighting
by preferred width plus the protected minimum includes the six-twip writing
reserve and fixed noWrap width. Cumulative integer boundaries retain the
combined span minimum without independently rounding every share upward.

Before this correction the noWrap controls differed by up to 16.7 points.
Both now match native widths exactly in integer twips. Other cases match within
one twip, with remaining one-twip allocation differences explicitly allowed by
the test. This is not a claim of universal exact AutoFit equivalence.

`tests/browser/autofit-span-floor.spec.js` verifies every native cell width,
page assignment, editable opening, insertion, undo, reopening and untouched
package parts. The existing crossing-span suite retains its original 0.2-point
PDF boundary tolerance; modern, series and content are no longer expected
failures. No corpus document is promoted to complete based on these controls.
