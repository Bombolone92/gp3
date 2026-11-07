# Image-mask band-amplitude counterexamples

Six original 48×180 RGB masks contain a three-source-pixel white vertical band on backgrounds 0, 17, 83, 128, 190 and 254. Each reduces to 16×60. Generate with `python tools/svg_image_mask_kernel_fixture.py --amplitudes --kernel-scale 3 --output-dir tests/fixtures/svg-image-mask-amplitudes`.

The reference application captured the exact source read-only on 2026-09-29 using `tools/capture-svg-group-raster.ps1`; `tools/record_svg_mask_kernel.py` extracted the six native PNGs. Source, case inventory, capture, nested metafile and PNGs are hash-bound. The middle band alpha values are 222, 224, 233, 238, 247 and 255. There is no corpus artwork or redistributed font.

Run `python tools/probe_svg_mask_cubic.py output.json --integral-table --include-three --include-amplitudes`. The held candidate matches 23/32 rasters and deliberately exits 1. Four new amplitudes fail: background 0 has 120 differing pixels (max 2), 17 has 120 (max 1), 83 has 180 (max 1), and 190 has 60 (max 1). Backgrounds 128 and 254 match.

This corrects an overly broad inference from the previous one-dimensional band: matching a single amplitude did not establish its kernel weight. The new native evidence proves an underlying one-dimensional kernel discrepancy; it cannot be repaired solely by changing two-dimensional intermediate rounding. No pixel tolerance or expected failure is weakened. No candidate is used in production.

A separate native GDI+ amplitude sweep bounds the center coefficient near 0.86945, versus about 0.86458 in the held model. Its six standalone samples agree with these native rasters. That numerical interval is diagnostic evidence, not an OOXML/SVG requirement or a browser implementation contract. GDI+ one-pass resizing matches the preceding six kernel controls; two native calls apply additional filtering on their unchanged axes, so those calls do not isolate intermediate quantization.

The associated evidence JSON preserves the exact native comparisons. SVG/OOXML do not prescribe these byte-level sampling rules; this remains compatibility work for corpus document #288, which remains partial.
