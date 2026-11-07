# Discretionary-hyphen line metrics

`tools/discretionary_hyphen_metrics_fixture.py` creates 24 original controls:
Arial 10/15/20pt, a 54pt-wide picture at 18/36pt height, and four tails:
optional hyphen + XYZ, literal hyphen + XYZ, space + XYZ, and a + space + XYZ.
The picture is an original solid-color PNG. The package uses python-docx's
standard scaffold, with compatibility mode 15 and one control per page.

The reference application exported the exact `control.docx` read-only to
`native.pdf` (24 pages). `tools/record_discretionary_hyphen_metrics.py` records
native character origins, source/PDF hashes, and text without using engine
geometry. All ten source XML schema checks pass.

These controls isolated the following layout defect on main 6719e005:

- All eighteen literal-hyphen, space, and letter controls match native text
  and wrapping, with measured baseline differences below 0.07pt.
- At 10pt and 15pt, the discretionary hyphen's baseline matches, but following
  baselines are about 2.1pt and 3.2pt too low, respectively, at both image heights.
- At 20pt with a 36pt-high picture, following baselines are about 4.3pt too low.
- At 20pt with an 18pt-high picture, the discretionary hyphen is 4.264pt too
  high while following baselines match within 0.06pt.

The last case prevents treating this as a constant offset to following lines.
The engine now retains the chosen optional hyphen's identity while painting a
hyphen-minus. A fragment consisting only of whitespace and that chosen hyphen
does not turn a picture-only line into a mixed text line. Its font still supplies
the minimum height; its descender is not appended below the picture. Actual text
and literal hyphens keep their existing behavior. Source caret offsets and the
serialized softHyphen element are unchanged.

All 24 controls now match native text/wrapping and baseline positions within
0.07pt. `tests/browser/inline-soft-hyphens.spec.js` asserts both axes within
0.15pt, including the previously failing cases in the older 32-page mode 14/15
matrix, and checks text edits, unrelated parts, no-edit/undo equality and reopen.

ECMA-376 Part 1 §17.3.3.29 specifies the optional hyphen's visibility at chosen
breaks. This experiment establishes native line-metric behavior, not a claimed
contradiction of an explicit metric rule. Existing picture-font, whitespace,
shifted-picture and ordinary soft-hyphen regressions also run. This matrix does
not independently certify every optional-hyphen combination with font shifts,
decorations or bidi text. The older matrix's two expected failures are removed;
all pages are checked at the original tolerance.
