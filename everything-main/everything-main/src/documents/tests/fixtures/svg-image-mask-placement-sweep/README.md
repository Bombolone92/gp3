# Fractional horizontal phase sweep

Companion to [the placement controls](../svg-image-mask-placement/README.md). The same original checker and 20.5×64.75 viewport are translated horizontally by -2.5, -2.375, -2.125, -1.875, -1.625 and -1.5; y stays -2. Every viewport overscans its 16×60 mask.

Generate with `python tools/svg_image_mask_placement_fixture.py --sweep`; capture/record using the companion instructions with this fixture directory. The reference application captured these exact sources read-only on 2026-09-29. Native GDI+ matches all six native rasters exactly. The retained source/native hashes and the fixture tests bind the results.

```text
python tools/probe_svg_mask_placement.py sweep.json --sweep
python tools/probe_svg_mask_placement.py reflected.json --sweep --reflect-x
python tools/probe_svg_mask_placement.py preserved.json --sweep --reflect-x --preserve-half-x
```

Unadjusted eighth-pixel x placements differ by up to 68 alpha levels. Reflection substantially improves them, but moves both exact half-pixel cases incorrectly (maximum error 87). Preserving exact halves removes that regression; small one/two-level errors remain, so the diagnostic still exits 1. This rules out both a blanket half-pixel shift and unconditional reflection. Do not integrate either as a generic image-placement correction.

See [the companion README](../svg-image-mask-placement/README.md) for validation, reproduction and remaining limitations. No corpus artwork or production renderer changes are included.
