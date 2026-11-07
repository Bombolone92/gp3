# Native channel-permutation controls

These original controls isolate channel ordering in the unresolved WML theme
tint/shade conversion. Reproduce the source with:

```
python tools/theme_color_precision_fixture.py --bases 4F81BD 4FBD81 814FBD 81BD4F BD4F81 BD814F 808080 010203 --output-dir tests/fixtures/theme-permutations
```

The reference application opened this source read-only and exported `native.pdf`
(four pages). `tools/record_theme_boundary_colors.py` extracted 128 native text
fill colors and bound the source, cases and PDF with SHA-256 hashes. The source
passes the transitional document, settings and theme schemas.

The six permutations of RGB (79, 129, 189) produce exactly the same channel
values after undoing their permutations for every tested tint/shade byte:
00, 01, 40, 80, 99, BF, FE and FF. This rules out channel-order-dependent
conversion errors for these controls; it does not identify the reference application's complete
precision algorithm. The other two bases retain achromatic and dark controls.

This evidence accompanies `theme-conversion-stages`, which shows that the
existing DrawingML converter cannot simply replace WML conversion. Neither
fixture certifies the current renderer or makes a corpus template complete.
The relevant WML property is ECMA-376 Part 1 §17.3.2.6; MS-OI29500 §2.1.72
describes the HSL interpretation. No new normative divergence is asserted.
