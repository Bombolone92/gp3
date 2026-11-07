# Zero-height drawings on image-only lines

These original OPC/DrawingML controls contain no private corpus content.
Generate with `tools/flat_line_baseline_fixture.py`, export read-only through
the reference application with `tools/flat_line_baseline_native.ps1`, then measure with
`tools/record_flat_line_baseline.py`. The references bind source/PDF hashes and
record the reference application. Both sources pass the transitional and supported DrawingML
extension schemas. Each compatibility-mode source contains thirteen pages.

The controls distinguish zero-height horizontal lines from one-point/twelve-point
objects and vertical lines. They cover Arial/Century Gothic, font sizes, a drawing
run larger than its paragraph mark, body/table contexts, raised runs, effect
extents, adjacent text, automatic spacing, minimum spacing and exact spacing.
The recorder extracts native red-stroke endpoints directly from PDF operators,
plus the following paragraph's baseline. It does not use application geometry.

An otherwise image-only line with an unshifted zero-height drawing and no vertical
effect reservation retains the paragraph's text ascent and descent. The reference application does
not convert the font descent to ascent as it does for positive-height inline
objects. Its drawing-run font does not override the paragraph mark's minimum
height, including in compatibility mode 15. Minimum line spacing still uses the
image-only bottom alignment; exact spacing retains the existing 80% baseline.
The new branch applies to zero reserved ascent/descent, not to filenames, shape
IDs, a particular font or a particular stroke width. Raised or nonzero-reservation
objects retain their existing placement.

For the Arial 12 pt control, the old app painted at y=97.297852 pt versus the reference application's
94.75 pt. The corrected result is 94.754883 pt. With Century Gothic 10 pt, it moves
from 95.759766 to 93.557617 pt versus the reference application's 93.56 pt. A 24 pt drawing run with a
12 pt paragraph mark previously enlarged a mode-15 line and displaced following
text; the reference application uses the smaller mark metrics for this zero-height case.

ECMA-376 Part 1 §§20.4.2.8 `inline`, 20.4.2.7 `extent`, 20.4.2.6 `effectExtent`,
17.3.1.29 paragraph-mark `rPr`, 17.3.1.33 `spacing`, and 17.3.1.39 `textAlignment`
apply. The last clause leaves omitted/automatic vertical character alignment to
the consumer. The controls refine the reference application's consumer behavior; they do not establish
a contradiction of a mandatory baseline formula. Zero drawing extents are
permitted by the coordinate schema, as established by the earlier flat-line set.

## Explicit remaining control gap

Twenty-five of the 26 native object positions match within 0.1 pt. All 26 following
paragraph baselines match within 0.1 pt. The legacy mode-12 `effect-extents-zero`
control still paints 2 pt above the native reference, which adds a further top effect offset to
the visible frame. It already failed before the baseline correction and has a
positive reservation, so the new branch does not affect it. Its x coordinate,
following baseline and package preservation remain tested, but its top/bottom
position is explicitly excluded from the 25-case fidelity claim. Its reference
remains in the fixture for the separate effect-offset investigation.

Unit checks cover mark metrics, flat-line hit testing, retained drawing XML,
unrelated parts, editing, reopen and exact ZIP undo. Browser checks use native
coordinates, click a zero-height stroke, save untouched/edited/undone packages,
and reopen editable. Production drawing XML and assets are unchanged.

Validation: 28 unit checks across four files and 12 browser checks pass.
All 13 browser exports pass the supported schemas. The production build and
license gate pass. The private triggering corpus document also passes its final
visual comparison, clipboard edits, exact undo, editable reopen and five export
schema checks; it is not redistributed with these controls.
