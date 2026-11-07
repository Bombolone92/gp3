# Three-to-one image-mask kernel controls

These six original controls isolate the unresolved cubic stage in corpus document #288's SVG image masks. Each 48×180 opaque gray/white PNG reduces to 16×60. Patterns are a constant, vertical band, horizontal band, square, diagonal and ellipse. Bands/square are three source pixels wide; the background is gray 128. No corpus artwork or font asset is included.

Generate with `python tools/svg_image_mask_kernel_fixture.py --kernel-scale 3 --output-dir tests/fixtures/svg-image-mask-kernel-three`. On 2026-09-29, the reference application opened the exact source read-only. `tools/capture-svg-group-raster.ps1` captured the first inline range; `tools/record_svg_mask_kernel.py` extracted six native metafile PNGs. Source, cases, capture, nested metafile and PNGs are hash-bound. The ellipse PNG is byte-identical to the existing 3:1 scale control. The default 8:1 generator still reproduces every original ZIP part byte.

Run the two deliberately failing numerical probes:

```text
python tools/probe_svg_mask_cubic.py sampled.json --include-three
python tools/probe_svg_mask_cubic.py integral.json --include-three --integral-table
```

The original 64-samples-per-source-pixel model and the held 128-samples-per-kernel-unit integral-table model both match 21/26 controls. The table reduces changed alpha pixels from 217 to 98. On the new controls, constant/vertical/horizontal cases match exactly; square differs at 2 pixels (max 1), diagonal at 9 (max 2), ellipse at 32 (max 1). The existing 3:1 and 6:1 ellipses also remain failing. The table is an original numerical hypothesis, not copied native code and not called by the renderer.

Reversing the passes lowers exact matches to 14/26. Keeping float intermediates gives 14/26; truncating them gives 5/26. Round-to-even does not remove the five failing cases. These reject simple pass-order/intermediate-rounding substitutions; they do not establish the final kernel. Separate Fant preprocessing errors, fractional/anisotropic scales, JPEG/color/alpha handling, browser integration and performance remain open.

SVG/OOXML do not prescribe these precise resampling bytes. This is native compatibility evidence, not a normative standards claim or a completed corpus-document certificate. Browser native-alpha expected failures are retained. No production code changes in this step.

## Amplitude follow-up

The later [band-amplitude controls](../svg-image-mask-amplitudes/README.md) show that the matching gray-128 bands do not establish general one-dimensional fidelity. Four other contrasts fail the same held kernel. The next investigation must correct the kernel weights themselves, rather than assuming only two-dimensional rounding is wrong.

## Centered-grid follow-up (2026-09-29)

An original centered-grid hypothesis now matches all 32 integer-scale controls, including all six band amplitudes. It uses a symmetric discrete cubic cumulative sum when the output kernel center lies at a source pixel center, retaining the previous signed integral table elsewhere. This distinguishes previously indistinguishable one-dimensional amplitude cases; it is an empirical hypothesis, not a proven general native algorithm.

```text
python tools/probe_svg_mask_cubic.py integer.json --centered-grid --include-three --include-amplitudes
python tools/probe_svg_mask_cubic.py fractional.json --centered-grid --include-three --include-amplitudes --include-fractional
```

The first command exits 0 (32/32). The second deliberately exits 1 (32/38): the fractional factors 1.25, 1.5, 2.25, 2.5, 3.5 and 4.25 differ at 6, 12, 6, 14, 10 and 12 alpha pixels respectively (60 total; maximum error 2). The 4.25 case uses the held portable Fant prefilter for its odd height; that prefilter is also not generally exact. The default and `--integral-table` modes remain available for comparison.

These results do not authorize runtime integration or completing corpus document #288. Fractional weights, general Fant preprocessing, anisotropic scales, color/alpha behavior, browser integration and performance remain unverified or failing. SVG/OOXML do not mandate these native resampling bytes. Existing native-alpha expected failures remain intact.
