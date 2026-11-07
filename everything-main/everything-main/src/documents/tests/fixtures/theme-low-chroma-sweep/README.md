# Native low-chroma shade sweeps — unresolved rendering

These 512 independently authored cases vary every shade byte for `7F8080`
(HSL midpoint) and `80817F` (just above it). They contain no corpus artwork,
external resources or embedded font binaries. Reproduce their deterministic
source with the existing original generator:

```powershell
python tools/theme_color_precision_fixture.py --bases 7F8080 80817F 808080 000000 FFFFFF FF0000 00FF00 0000FF --full-shades --output-dir tests/fixtures/theme-low-chroma-sweep
```

The full-shades mode uses only the first two bases. Each label has themed text,
cell fill and a border with deliberately incorrect RGB caches. The reference application
opened the exact source read-only and exported the 15-page `native.pdf` and a
separate private saved DOCX using `tools/export-reference.ps1`. The source
still equals a freshly regenerated package byte-for-byte. The source was closed
without saving; no user document was changed.

`tools/record_theme_boundary_colors.py` extracts all 512 PDF text colors and
requires matching labels and opaque text. `tools/record_theme_saved_colors.py`
independently checks every saved RGB fallback against those colors. Both agree
for every case. Source, cases and PDF hashes are in `reference.json`; saved
attributes and the private saved-package hash are in `native-saved-colors.json`.
This reference measures text colors, not every fill/border or all page geometry.

## New constraint on conversion

In the dark half of HSL, fixed initial HSL values followed by exact shade
multiplication give each unrounded channel `k * modifier`, for some constant
`k`. Even allowing an arbitrary fixed output bias cannot explain the second
base's red channel. Matching native black at modifier zero constrains that bias
to `[0,1)` in this model:

| Shade byte | Native RGB | Red |
| --- | --- | --- |
| 2 | 1, 1, 1 | 1 |
| 44 | 21, 22, 21 | 21 |
| 128 | 64, 64, 63 | 64 |

For `floor(k * modifier + bias)`, the first pair requires `k < 21/42 = 1/2`;
the second requires `k > 42/84 = 1/2`. Both inequalities are strict, so no `k`
or constant bias can satisfy them. Ordinary nearest/floor output and arbitrary
fixed initial HSL quantization are special cases of this rejected model.

`python tools/check_theme_shade_linearity.py` verifies native artifact hashes,
proves the dark-half precondition from native extrema, and calculates exact
rational interval intersections. `linearity-rejection.json` retains its results.
It also records the weaker floor/nearest constraints for both bases. A nonempty
interval is inconclusive, not a rendering pass. Its zero exit status means the
recorded contradictions were reproduced; it does not certify the renderer.

This extends the earlier fixed-saturation rejection: a one-time adjustment to
any initial HSL component, or a constant output bias, is insufficient. The next
investigation must include intermediate arithmetic/quantization or another
modifier-dependent conversion stage. No new conversion rule is justified here.

The current renderer matches only **68/512** native colors. The existing
`node tools/check-theme-color-boundaries.mjs tests/fixtures/theme-low-chroma-sweep`
diagnostic deliberately exits nonzero. Full-precision HSL with final floor
matches 427/512, so changing rounding alone is not a fix either.

The source, native evidence and rational witnesses have local provenance tests.
The browser test checks editable opening, all labels, package preservation,
insertion, exact undo and reopening; it does not assert an exact native color match.
This large control explicitly waits for the new editor to attach before making
content assertions, including reopening. Initial attempts reached the default
five-second assertion limits while loading/opening the file. This new large
control uses an explicit 180-second readiness bound within its 240-second test
budget and records open/reopen elapsed times. No renderer timing change or
previously existing test threshold was altered; loading latency remains a note.

Semantics: ECMA-376 Part 1 §17.3.2.6 and
[MS-OI29500 §2.1.72](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/8229a077-7fc8-4fba-96cc-c77b6a4fc768).
That implementation note documents the HSL interpretation but not these intermediate rounding
steps. These observations add arithmetic constraints, not a new specification
divergence or a complete implementation.
