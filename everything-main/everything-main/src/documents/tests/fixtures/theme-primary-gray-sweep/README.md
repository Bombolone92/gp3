# Native achromatic theme controls

Original OOXML authored by `tools/theme_color_precision_fixture.py`; no external template or engine. Regenerate with `--full-shades --bases FF0000 808080 00FF00 0000FF 000000 FFFFFF 404040 C0C0C0 --output-dir tests/fixtures/theme-primary-gray-sweep`. All 256 modifier bytes for each of two bases occur in text, cell shading and top borders. Deliberately incorrect cached RGB values test theme precedence.

`native.pdf` was exported from this exact control by the reference application on 2026-09-28, using `tools/export-reference.ps1`. `tools/record_theme_boundary_colors.py` reads native PDF text colors independently of the renderer. `reference.json` binds DOCX, cases and PDF by SHA-256. No font files are distributed.

ECMA-376 Part 1 §§17.3.2.6 (color), 17.3.5 (common shading/border properties), 17.18.98 (byte modifiers); MS-OI29500 §2.1.72 describes the HSL interpretation. These controls establish truncation for the achromatic cases, not a complete chromatic conversion model. Native PDF and browser pagination differ within the 15-page sweeps; color tests compare corresponding labels/rows rather than assuming native page membership matches the viewer.
