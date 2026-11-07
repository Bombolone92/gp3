# Fractional image-mask impulse controls

Six original opaque grayscale PNG masks, each 24×90 pixels, reduce to 16×60 (1.5:1). Each has one white source column on a constant background. `cases.json` records the source column and background. Positions 10–15 and backgrounds 22, 128, 128, 128, 26 and 7 isolate kernel lobes and rounding boundaries. No corpus artwork or fonts are copied.

Generate and capture from the repository root:

```text
python tools/svg_image_mask_kernel_fixture.py --fractional-impulses --output-dir tests/fixtures/svg-image-mask-fractional-impulses
powershell -File tools/capture-svg-group-raster.ps1 -SourcePath tests/fixtures/svg-image-mask-fractional-impulses/control.docx -OutputPath tests/fixtures/svg-image-mask-fractional-impulses/capture.emf
python tools/record_svg_mask_kernel.py tests/fixtures/svg-image-mask-fractional-impulses/capture.emf tests/fixtures/svg-image-mask-fractional-impulses
```

The reference application opened the exact source read-only on 2026-09-29. The native nested metafile and six extracted PNGs are hash-bound to the source and capture. At destination column 8, the native alphas are **5, 146, 204, 179, 17, 0**. A separate local GDI+ HighQualityBicubic, PixelOffsetMode.Half, TileFlipXY resize agrees with every alpha pixel of all six native masks. This isolates a one-dimensional kernel issue; it is not only a two-dimensional ellipse or final-compositing mismatch.

Both diagnostic commands below intentionally exit 1:

```text
python tools/probe_svg_mask_cubic.py centered.json --centered-grid --include-three --include-amplitudes --include-fractional --include-fractional-impulses
python tools/probe_svg_mask_cubic.py reciprocal.json --float-reciprocal --include-three --include-amplitudes --include-fractional --include-fractional-impulses
```

The centered-grid hypothesis matches only two of these six new controls. The float32-reciprocal coordinate hypothesis matches only one. Although the latter reproduces all 32 integer controls without a special center branch and improves one earlier fractional ellipse, it is not a general correction. Across all 44 controls both match 34; centered-grid differs at 480 pixels (total absolute alpha error 482), while float-reciprocal differs at 696 (total error 760).

The new fixture opens as one editable browser page and passes no-edit package preservation, insertion, unrelated-part preservation, exact undo and edited reopen. Source and all three exported packages pass the XML checks. Ten native fixture tests pass. The default generator reproduces every ZIP part of its existing control.

No production rendering algorithm changes here. Corpus document #288 remains partial. SVG/OOXML do not prescribe these exact native resampling bytes; this is compatibility evidence, not a standards divergence. General fractional weights, Fant preprocessing, color/alpha behavior and integration remain unresolved.

## Cumulative-table and index-accumulation follow-up

The later `--accumulated-grid` diagnostic rounds the cumulative cubic table to 16-bit precision and advances its lookup index by `128 / scale` for each source pixel. It does not special-case the source-center phase. The new one-pixel controls distinguish this from merely quantizing cubic samples or recomputing each boundary index independently.

```text
python tools/probe_svg_mask_cubic.py accumulated.json --accumulated-grid --include-three --include-amplitudes --include-fractional --include-fractional-impulses
```

This reproduces **41/44** controls, including all six fractional impulses and every previously matching control. Differing alpha pixels fall from 480 to 22. It still deliberately exits 1: fractional factors 1.25, 2.5 and 4.25 differ at 6, 2 and 14 pixels, all by one level. The 4.25 case still depends on the held Fant prefilter.

Changing cumulative rounding ties to half-up or away-from-zero does not eliminate these failures. Recomputing or shifting the initial index can regress many controls. The accumulated model therefore remains an empirical, unreleased hypothesis. The three fractional discrepancies, arbitrary scales, color/alpha support and actual browser integration remain open; #288 is not promoted.
