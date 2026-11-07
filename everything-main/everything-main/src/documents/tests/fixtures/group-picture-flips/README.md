`tools/canvas_group_picture_flips_fixture.py` independently authors the OPC/XML
and four-color PNG with the Python standard library. No template artwork or
third-party rendering engine is used.

The reference application opened the exact public fixture and exported `native.pdf` and
`native.xml` without saving changes. Source/capture hashes are in `manifest.json`.
The six pictures cover no reflection, horizontal, vertical, both, cropped
horizontal, and both with asymmetric transparent crop margins. Each picture
is inside two groups with nonuniform scale and nonzero child origins.

`samples.json` contains 16 interior RGB samples per case from the native reference PDF
rendered with PDFium at two pixels per point. A frame starts at (72, 100+95*i)
points and measures 144 by 72 points. Sample positions are frame fractions.
The browser test checks these 96 colors on the actual document canvas before
and after editing, exact undo and reopening; exports retain source artwork.

The reference application agrees with the standard's frame-centered reflection and crop-before-flip
behavior in these probes. This does not verify rotation or group/shape-level
reflection, which remain explicitly unsupported.
