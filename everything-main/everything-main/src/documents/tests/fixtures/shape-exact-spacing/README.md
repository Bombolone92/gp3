# Exact line spacing in text boxes: native reference

Original XML authored by `tools/shape_exact_spacing_fixture.py`, using the
project's original dense-guides OPC shell. No corpus content is redistributed.
`native.pdf` was exported by the reference application without saving the source.
`tools/record_shape_exact_spacing.py` records visible ink bands and source/PDF
hashes. `native.png` is a visual overview of that PDF.

Eight 24-point Arial controls compare exact 8, 14, 24 and 36 point spacing,
14-point minimum spacing, single automatic spacing, and exact 14-point spacing
with center/bottom vertical alignment. Each text box contains two lines.

**Reference/spec divergence:** ECMA-376 Part 1 §17.18.48 ST_LineSpacingRule says
oversized exact-line contents shall be clipped. The reference application's text boxes instead allow
glyphs to overlap adjacent lines and extend below the last line band, subject
to the enclosing text-frame clip. For example the first 8-point control's
visible ink extends to page y=125.5 pt, beyond its line band's bottom at 122 pt.
The 14-point control similarly extends to 136.25 pt, beyond 134 pt.
The implementation follows the native reference for shape text, retaining body-line clipping.

The reference application also places the baseline at 80% of exact line height. PDF first baselines
are y=112.46, 117.26, 265.25 and 274.85 pt for the four top-aligned controls;
relative to writing tops 106, 106, 246 and 246 pt these agree with 0.8 times
8, 14, 24 and 36 pt (native reference PDF coordinate quantization is below 0.1 pt).
Automatic/minimum spacing continues to use font metrics. Vertical anchoring
uses the line extents, not the overflowing glyph ink.

Browser tests measure actual colored ink bands against the reference application within 1 pt,
including after host-text edits and reopen; retained shape XML and exact undo
package contents are checked. Unit tests cover group scaling, unmodified body
clipping, zero exact spacing, and unchanged minimum/automatic metrics. These
controls do not establish support for decorated runs, text-box fields, tables,
or multiple text columns.
