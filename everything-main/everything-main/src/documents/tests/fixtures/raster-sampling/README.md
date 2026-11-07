# Raster downsampling controls

`tools/raster_sampling_fixture.py` independently builds a DOCX with original
1000-by-500 PNG artwork: one-pixel black/white stripes and a blue diagonal.
Four 111-by-55.5 CSS-pixel frames exercise inline pictures, fractional source
cropping, a DrawingML group and a stretched shape picture fill. No corpus asset
or font is redistributed. The generator uses existing permissively licensed
Python libraries; it does not call the application's importer or exporter.

The reference application opened the exact source read-only, repaginated and
exported `reference.pdf` using `tools/export-reference.ps1`.
`tools/record_raster_sampling.py` renders that PDF at 4x and BOX-downsamples it
to 96 dpi, then records hashes and stripe-region means/standard deviations.
Both native and app pages were inspected, including the diagonal edges.

The browser test checks average tone and absence of aliasing across all four
paths against the native regions, plus no-edit package equality, body editing,
unrelated-part preservation, exact undo and editable export/reopen. Separate
checks exercise reuse of immutable samples, crop/density invalidation and a
closed bitmap. These are sampling checks, not a pixel-identity claim for all
browser and the reference application rasterizers.

OOXML Part 1 sections 20.1.8.13 (blip), 20.1.8.14 (blipFill), 20.1.8.55
(srcRect), 20.1.8.56 (stretch) and 20.2 (pictures) retain their established
geometry and package semantics. The sampling filter is a renderer choice;
this control does not establish a divergence in OOXML interpretation.
