# Independent theme-color boundary controls — unresolved

These 128 original WordprocessingML controls extend `theme-color-precision`
with four achromatic bases and four colors close to hue boundaries. They use
deliberately incorrect RGB caches, themed text, cell shading and table borders.
They contain no corpus content or third-party engine output.

Generate from the repository root:

```
python tools/theme_color_precision_fixture.py --bases 404040 A0A0A0 C9C9C9 FEFEFE FF0100 FEFF00 00FEFF 0100FF --output-dir tests/fixtures/theme-color-boundaries
```

The reference application opened this source and exported the four-page
`native.pdf` using `tools/export-reference.ps1`. All three source XML parts
pass the transitional schemas. `reference.json` binds the source, case
inventory and PDF by SHA-256 and records native PDF text fill colors, extracted
by `python tools/record_theme_boundary_colors.py tests/fixtures/theme-color-boundaries`.
The recorder checks all labels and opacity; the reference does not claim to
have independently measured every shaded cell or border.

The current nearest-byte HSL conversion matches 84/128 native text colors
(44/64 achromatic, 40/64 chromatic). Full-precision HSL followed by truncation
matches all 128 here, but still fails 24 of the original precision controls.
Thus these controls do not justify adopting truncation as a complete fix.
`node tools/check-theme-color-boundaries.mjs` verifies the native artifact hashes
and reports the current 44 mismatches with a deliberate nonzero exit status.

The earlier exploratory hue candidate `floor(hue * 256) / 255`, followed by
truncation, matches only 108/128 here. It incorrectly moves the dominant
channel for FEFF00, among other failures. Its better fit on the original
eight RGB bases is insufficient evidence for the reference application's conversion algorithm.
No candidate was installed in production. The generic precision gap remains
open; these native controls must be retained when evaluating its eventual fix.

Relevant specification context remains ECMA-376 Part 1 §17.3.2.6 and
MS-OI29500 §2.1.72, which describes applying these transformations to HSL lightness.
