# Gray base boundary controls

Original OOXML generated with `tools/theme_color_precision_fixture.py --bases 020202 2A2A2A 404040 7F7F7F 818181 C0C0C0 FEFEFE F8F8F8 --output-dir tests/fixtures/theme-gray-boundaries`.

The eight bases include the directly used gray theme bases in corpus #22 and #151, near-black/near-white endpoints and neighbors of midgray. Each has eight tint and eight shade bytes: 0, 1, 64, 128, 153, 191, 254, 255. Each case independently declares text, cell shading and a top border with a deliberately wrong cached RGB fallback.

The reference application exported `native.pdf` on 2026-09-28 using `tools/export-reference.ps1`. `tools/record_theme_boundary_colors.py` extracts text colors from the native PDF without using renderer conversion. SHA-256 hashes bind that PDF to the exact source and inventory; the ZIP timestamp is not a reproducibility guarantee for this non-sweep generator mode. No original corpus document or third-party font is distributed.

ECMA-376 Part 1 §§17.3.2.6, 17.3.5, 17.18.98 and MS-OI29500 §2.1.72 apply. All 128 cases follow the existing achromatic truncation implementation; this expands evidence without changing runtime code. Chromatic precision remains open.
