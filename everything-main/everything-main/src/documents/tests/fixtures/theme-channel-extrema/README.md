# Native minimum/maximum theme-channel controls

These original controls extend the existing `theme-permutations` evidence with
six tied-channel colors: each RGB position is tested as the sole minimum, sole
maximum, one of two minima and one of two maxima. The shared extremes are 79 and
189. The ordinary 4F81BD and C0504D bases retain comparison with earlier captures.
Each base has eight tint and eight shade modifiers, for 128 cases.

The reference application preserves the ordinary 4F81BD minimum/maximum output channels in
all 96 tied-channel cases. For example, shade 153 gives 4F81BD -> 2C4C74,
4F4FBD -> 2C2C74 and BDBD4F -> 74742C. Changing or duplicating the middle channel
does not change these native extrema. The observed precision error therefore
persists without middle-channel interpolation; correcting hue alone cannot
resolve it. This is a constraint on the investigation, not the complete native
conversion algorithm.

The saved reference RGB fallbacks agree with all 128 independently extracted PDF
colors. The reference application removes the identity FF modifier when saving; the original source
retains it. No source rewriting or renderer change accompanies these controls.
The source uses deliberately incorrect cached RGB values, so accepting them
cannot pass the native comparison. No corpus artwork or font binaries are used.

Reproduce from the repository root:

```powershell
python tools/theme_color_precision_fixture.py --bases 4F81BD 4F4FBD 4FBD4F BD4F4F BDBD4F BD4FBD 4FBDBD C0504D --output-dir tests/fixtures/theme-channel-extrema
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/theme-channel-extrema/control.docx" -OutputPdf "$PWD/tests/fixtures/theme-channel-extrema/native.pdf" -OutputDocx "$env:TEMP/theme-extrema-saved.docx"
python tools/record_theme_boundary_colors.py tests/fixtures/theme-channel-extrema
python tools/record_theme_saved_colors.py tests/fixtures/theme-channel-extrema "$env:TEMP/theme-extrema-saved.docx" --reference-build 16.0.20326
npx vitest run tests/theme-channel-extrema.test.js tests/theme-permutations.test.js tests/theme-color-complements.test.js
node tools/check-theme-color-boundaries.mjs tests/fixtures/theme-channel-extrema
```

The final command intentionally fails: the current renderer matches 40/128
native colors and misses 88. Seven provenance/invariant tests pass, but they do
not certify rendering. The browser opens four editable pages and passes exact
no-edit retention, insertion, unrelated-part retention, exact undo and edited
reopening. Source and three browser exports pass 12 XML schema checks locally.

Native source, cases and PDF hashes are in `reference.json`; extracted
saved attributes and the private saved-package hash are in
`native-saved-colors.json`. The existing ECMA-376 Part 1 §17.3.2.6 and MS-OI29500
§2.1.72 HSL compatibility issue remains open. This adds precision evidence, not
a newly established normative divergence or a completion verdict for #89/#321.
The next conversion investigation must explain the minimum/maximum channels
before attempting to correct hue interpolation.

## Exact rejection of a fixed-saturation correction

`python tools/check_theme_extrema_constraints.py` uses the existing full
`theme-shade-sweep` reference and exact rational arithmetic. Under ordinary
HSL, dark output has maximum channel `L*(1+S)`. If the final step is floor,
observing maximum `q` requires `q/L - 1 <= S < (q+1)/L - 1`.

For 4F81BD, native shade 72 requires `S >= 1459/3216` (about 0.453669),
while shade 4 requires `S < 229/536` (about 0.427239). For C0504D,
shade 226 requires `S >= 14483/30397` (about 0.476461), while shade 4
requires `S < 227/538` (about 0.421933). Both intersections are empty.

Thus no choice of one saturation value per base, including arbitrary rounding
or quantization of that value, can fix these native maxima while keeping the
specified exact lightness transformation and a sole final truncation. Hue is
absent from this calculation. This does not rule out intermediate arithmetic,
different final conversion, or transformed-lightness quantization; it does not
identify which one the reference application uses. The diagnostic exits zero when it proves rejection,
not when the renderer matches the reference application. Its source/PDF bindings are verified first.

The broader finite arithmetic probes remained unsuccessful and are private
scratch diagnostics. No production color change follows this rejection. Future
work must investigate intermediate operations rather than another fixed HSL
saturation constant; #89/#321 remain partial.
