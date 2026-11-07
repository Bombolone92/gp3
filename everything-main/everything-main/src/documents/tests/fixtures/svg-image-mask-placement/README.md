# Fractional SVG image-mask placement controls

Six original 40×128 opaque grayscale checker images are placed over 16×60 masks. All six use identical pixels. The first uses a 20×64 viewport with integer translation; the others use 20.5×64.75 and separately vary x/y translation. `preserveAspectRatio="none"` isolates placement from aspect-ratio fitting. The viewport overscans the mask, so the comparison does not conflate partial image-edge coverage. No corpus assets are included.

```text
python tools/svg_image_mask_placement_fixture.py
powershell -File tools/capture-svg-group-raster.ps1 -SourcePath tests/fixtures/svg-image-mask-placement/control.docx -OutputPath tests/fixtures/svg-image-mask-placement/capture.emf
python tools/record_svg_mask_kernel.py tests/fixtures/svg-image-mask-placement/capture.emf tests/fixtures/svg-image-mask-placement
powershell -File tools/diagnose-svg-mask-placement.ps1 -FixtureFolder tests/fixtures/svg-image-mask-placement -OutputFolder work/placement-gdi
```

On 2026-09-29 the reference application opened the exact source read-only. The source, cases, capture, nested metafile and six extracted PNGs are hash-bound. A separate native GDI+ HighQualityBicubic / PixelOffsetMode.Half / TileFlipXY draw matches every native alpha pixel in these six controls and the companion phase sweep. The GDI diagnostic reads the original embedded PNG directly from the control DOCX.

The portable accumulated-grid model matches the integer case. Without phase adjustment, fractional x translation introduces errors up to 47 alpha levels; changing y alone leaves only one-level errors. A constant +0.5 x shift fixes some placements and regresses others. Reflecting x around its nearest integer reduces these six controls to a maximum error of 2, but is still not exact. The [phase sweep](../svg-image-mask-placement-sweep/README.md) disproves applying that reflection at exact half-pixel origins.

```text
python tools/probe_svg_mask_placement.py zero.json
python tools/probe_svg_mask_placement.py half-x.json --phase-x .5
python tools/probe_svg_mask_placement.py half-y.json --phase-y .5
python tools/probe_svg_mask_placement.py reflect.json --reflect-x --preserve-half-x
```

All these probes intentionally exit 1 while any pixels differ. The phase options are empirical hypotheses, not renderer corrections. Changing the vertical index to an absolute-coordinate formula improved one old control but worsened these, so that candidate was rejected.

Both placement DOCX files open as one editable page and pass no-edit preservation, insertion, unrelated-part preservation, exact undo and edited reopen. Eight source/export packages pass 80 XML checks. Twelve native fixture tests pass. `--output-dir` regenerates each control elsewhere; every ZIP part and cases manifest reproduce. Moving the cubic probe's CLI into `main()` made its numerical functions reusable without running comparisons on import; all five existing diagnostic modes retain their prior results.

These controls expose the reference application's rasterizer behavior, not a proven SVG/OOXML standards violation: exact resampling bytes are not prescribed. Rotation, arbitrary filters, transparent sources, image-edge coverage and remaining kernel errors need further evidence. No production rendering change or corpus-document promotion is made here.
