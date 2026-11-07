# Complementary tint/shade native controls

Original fixture generated with Python's standard library:

```text
python tools/theme_color_precision_fixture.py --bases B07E42 3FAFB2 9B4139 9B626C 7F7F7F 00FFFF FEFDFC 020100 --output-dir tests/fixtures/theme-color-complements
```

These eight bases are channel complements of `theme-color-precision`. Each has
eight shade and eight tint cases. Text, cell shading and cell borders carry the
same theme transformation and intentionally incorrect cached RGB fallbacks.
There is no corpus artwork, copied document XML or bundled font binary.

The reference application exported the exact source read-only on 2026-09-27.
`tools/record_theme_boundary_colors.py` extracted all 128 text colors from its
four-page PDF independently of the renderer. The source, case inventory and PDF
are hash-bound in `reference.json` and the native-evidence unit test.

Pair each original shade with the complementary base's tint at the same byte,
and vice versa. Exact HSL conversion gives complementary channels summing to
255. Native sums range from 253 to 255; 34 of 128 pairs have at least one sum of
253. For example, shade 153 of `4F81BD` is [44,76,116], whereas tint 153 of
`B07E42` is [211,177,137], summing to [255,253,253]. Ordinary final floor/nearest
conversion alone cannot account for this. The control establishes native
precision behavior; it does not yet identify the algorithm needed to emulate it.

`tools/check-theme-color-contexts.py` independently reads PDF filled rectangles
and compares their cell-fill and border colors with the text references. All
896 cases across the sweep, precision, boundary and complement fixtures agree
across these three painting contexts. The extractor is intentionally limited to
these original fixed-grid PDFs and rejects unsupported transforms/color spaces.

The new fixture opens as four editable pages. No-edit ZIP preservation, text
insertion, unrelated-part retention, exact undo and edited reopening pass, with
no browser errors. Source XML validation passes. These are editing/preservation
checks, not a claim that the app matches the new native colors. Template 90
remains partial; no production conversion rule changed.

Relevant semantics: ECMA-376 Part 1 section 17.3.2.6 and MS-OI29500 section
2.1.72 (theme tint/shade lightness transformation).
