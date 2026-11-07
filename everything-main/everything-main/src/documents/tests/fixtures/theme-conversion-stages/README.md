# Native color-conversion stages — unresolved WML precision

This diagnostic distinguishes ordinary WordprocessingML theme tint/shade from
equivalent DrawingML colors. It does not add renderer support or certify the
still-unresolved `themeColorTransform` implementation.

`tools/theme_conversion_stages_fixture.py` independently authors 48 cases from
eight RGB bases, shade/tint bytes 80, 99 and FF. Every case pairs themed text
with three plain rectangular swatches: sRGB plus luminance transforms, explicit
HSL plus the same transforms, and explicit HSL with the final lightness already
calculated. HSL and transform declarations use the nearest representable OOXML
integer. Consequently the DrawingML paths are mathematically equivalent before
that representational quantization, not guaranteed byte-identical.

The generator uses the repository's original theme and shape scaffolding and
contains no renderer imports, corpus content, third-party engine or font
binaries. Its code is covered by the repository license. Source DOCX bytes are
deterministic. The native PDF is reference-application output from this original source.

The reference application exported the three-page `native.pdf`.
`tools/record_theme_conversion_stages.py --reference-build 16.0.20326` independently
reads PDF text-fill colors and requires nine interior samples per swatch to
agree. `reference.json` binds the source, case inventory and PDF by hash.
The source passes both standard MCE and supported shape-extension schemas.

All 48 WML results match the earlier `theme-color-precision` native reference.
Each DrawingML path matches WML in only 25 of 48 cases. The sRGB-modifier path
matches the HSL-modifier path in 47 cases and the explicit final-HSL path in 46.
For example, 4F81BD with shade 99 is WML 2C4C74 but all three DrawingML paths
produce 2C4D75. These results rule out substituting the already-validated
DrawingML conversion as the complete WML correction. They do not establish
the native legacy precision algorithm. Direct `hslClr` remains a native-only
diagnostic here; this fixture is not claimed editable in the viewer.

Relevant definitions: ECMA-376 Part 1 §17.3.2.6 (`color`), §20.1.2.3.13
(`hslClr`), and §§20.1.2.3.20–21 (`lumMod`, `lumOff`). The WML HSL interpretation
is described by MS-OI29500 §2.1.72. The exact native precision remains open.
