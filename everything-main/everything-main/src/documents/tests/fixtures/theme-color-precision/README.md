# Native theme-color precision controls — unresolved

`tools/theme_color_precision_fixture.py` independently authors 128 controls:
eight varied RGB bases, shade/tint bytes 00, 01, 40, 80, 99, BF, FE and FF,
themed text, cell shading and cell borders. The fallback RGB is deliberately
incorrect (112233), preventing a reader from passing by trusting cached values.
No corpus content or third-party document engine is included.

The fixture passed official transitional schemas before capture. The reference application exported the four-page `native.pdf` and saved a separate
normalized copy. `native-colors.json` records PDFium text fill colors;
`native-saved-colors.json` records the RGB fallback and theme attributes written
by the reference application in that copy. All 128 saved RGB values agree exactly with PDF colors.
Thus the differences are not merely PDF export or raster antialiasing artifacts.

Run `node tools/check-theme-color-precision.mjs` to compare the engine against
the native reference. This is an explicitly failing diagnostic for an open
conformance gap, not a passing certification or a completed rendering fix.

The existing full-precision HSL calculation with nearest-byte output does not
match the reference application. Replacing final rounding with truncation still misses 24 controls.
Simple quantization of HSL components and the Windows ColorRGBToHLS/ColorHLSToRGB
APIs also failed to reproduce every control; those exploratory candidates have
not been installed in the engine. The generic conversion remains to be resolved.

A subsequent bounded probe of hue/saturation/lightness quantization, including
byte-scale numerator/denominator variants, reached 117/128 matches with 11
remaining one-channel mismatches. This is exploratory fit evidence, not a
validated algorithm; no candidate was installed. Quantizing only the final RGB
output remains insufficient, and passing a subset must not be treated as full
native-color conformance. The invoice reviewed as corpus entry 74 independently
shows the same precision gap in headings and two table-fill colors.

The later independent `../theme-color-boundaries` reference adds 128 grayscale
and near-boundary colors. Full-precision HSL with truncation matches that set,
but the exploratory byte-hue conversion fails 20 cases and can change the
dominant RGB channel. Its original-set fit is not a basis for implementation.
Both native sets are required evidence for the eventual generic correction.

ECMA-376 Part 1 §17.3.2.6 and
[MS-OI29500 §2.1.72](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/8229a077-7fc8-4fba-96cc-c77b6a4fc768)
describe the color properties and their HSL interpretation. The native result
for C0504D shaded by BF is 943634, exactly the implementation note's example.
The previous conformance text dismissed that difference as a rounded example;
these controls establish it as an actual engine mismatch.

The paired native `../theme-conversion-stages` diagnostic preserves 48 of these
WML results beside mathematically equivalent DrawingML sRGB/HSL paths. Each
DrawingML path matches only 25 of the WML colors. Reusing the resolved DrawingML
converter therefore does not close this WML gap; its independent reference and
generator are retained for the next precision investigation.
