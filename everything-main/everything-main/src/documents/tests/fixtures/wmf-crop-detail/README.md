# Vector detail through picture effects

`tools/wmf_crop_detail_fixture.py` authors WMF records directly and reuses our
own eight-picture OPC layout. Every picture contains fourteen thin horizontal
bands, twenty-seven vertical bands and a wide triangle. Paired standard and
placeable headers cover uncropped images, positive source cropping, reflected
crops and negative crop outsets. `control.docx` has no effects; `effects.docx`
applies one or two ordered duotones. There is no copied corpus artwork.

The matching PDFs were exported from the exact source packages by the reference application using the private, FullName-checked reference exporter. Each is
one page. The no-effect PDFs retain vector forms; the reference application rasterizes effect-bearing
pictures. Source and PDF hashes are bound by `reference.json`.

Before the fix, applying a color effect rasterized each vector at its intrinsic
dimensions. The placeable controls are only 96 by 44 CSS pixels; enlargement
merged their horizontal bands into broad blurred blocks. Standard WMFs also
lost detail under cropping and high device scale. The engine now retains the
validated vector and applies the same existing pixel transforms at the requested
display resolution. Original media, effect declarations and picture dimensions
are unchanged. Raster sources keep their one-time transformation path.

`tools/record_wmf_crop_detail.py` records 968 native color/gap samples and sixteen
line profiles across device scales 2 and 4 (192/384 dpi native PDF rendering).
Each profile independently resolves 14, 9, 9 or 14 horizontal bands according
to its crop. Standard WMFs compare exact interior colors and clear gaps.
Placeable WMFs compare wide triangle interior colors and resolved line counts.

**Remaining native difference:** The reference application scales the effect-bearing placeable WMF
slightly differently from the equivalent standard WMF and the no-effect vector.
For example, at 384 dpi the first pair's vertical-band centers have fitted
horizontal steps of 1.0677 and 1.0795 pixels per logical unit respectively.
The engine preserves its existing vector geometry for both. Placeable edge
positions/whitespace are therefore not claimed to match; this is retained as
a separate fidelity issue, not hidden with a loose positional tolerance.

Browser tests compare the native samples and band counts before and after
typing and reopening, with unrelated-part preservation and exact package undo.
Separate SVG/EMF checks verify that enlargement with color effects preserves
the original vector alpha silhouette and the ordered opaque color mapping.
Unit checks cover reuse, source/bitmap cleanup, effect failures, rotations,
crop scaling and the aggregate 4-megapixel display-sample bound. The LRU does
not retain source vectors or document objects. Extreme requests are capped;
they do not allocate unbounded full-size images for extreme source cropping.

DrawingML duotone (§20.1.8.23) and luminance (§20.1.8.42) color math remains
unchanged, including the existing partially transparent luminance rounding
gap. This fixture isolates display resolution from those color semantics.
