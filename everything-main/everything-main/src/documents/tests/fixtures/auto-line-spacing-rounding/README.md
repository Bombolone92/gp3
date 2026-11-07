# Long automatic line-spacing controls

Original OOXML from `tools/auto_line_spacing_rounding_fixture.py`, using the
repository's original outline-control OPC shell. No corpus text, artwork,
viewer layout calculations or font binaries are used in the generator.
Compatibility mode 15 is explicit. Three installed families (Arial, Trebuchet
MS and Times New Roman), three sizes (11/12/17pt) and three automatic spacing
values (240/259/276) are paired as 20 manual-break lines versus 20 paragraphs.
All runs and paragraph marks declare the same family and size, with zero
before/after spacing. Each pair starts on separate pages: 54 pages, 567
paragraphs, 513 manual breaks and 1080 visible LINE labels.

The reference application opened an exact-path-confirmed, byte-identical scratch copy.
A separate owned read-only reference application instance captured each actual Page object's
`EnhMetaFileBits`. The source hash remained unchanged and Saved stayed true.
The capture document and its proven newly created reference application instance were closed
without saving. Existing windows/dialogs were not dismissed or closed.

Unlike Range captures, these page captures preserve the source page geometry
and line layout. `native/page-capture.json` binds every EMF and source hash.
`tools/record_auto_line_spacing_pages.py` checks the hash bindings, bounded
record inventory, 600dpi header, identity transforms, baseline alignment,
logical page extent, face descriptors, labels and all 1080 baselines. It
normalizes logical coordinates using the captured Page.Width/Height; device
frame metadata is not used as a physical screen-raster reference. No font
program is embedded in these EMFs or bundled with this fixture.

All 27 native manual/paragraph pairs have identical baseline sequences. The
browser regression checks relative baselines within .12pt, the logical-unit
rounding envelope. It deliberately does not certify absolute first baselines,
empty paragraphs, mixed fonts, pictures, paragraph before/after spacing or
all compatibility modes. Those remain distinct investigations.

Regenerate the source with `python tools/auto_line_spacing_rounding_fixture.py`.
For a fresh capture, use the reference-opening helper to open/confirm an owned scratch
copy, then run `tools/capture_docx_page_metafiles.ps1` with that Source,
ExpectedSha256, ExpectedPages 54, ExpectedParagraphs 567, WidthPt 612 and
HeightPt 792, writing to a fresh OutputRoot. Validate it with
`python tools/record_auto_line_spacing_pages.py <capture-root> --output result.json`.
Do not replace committed references before reviewing new capture provenance.

OOXML: ECMA-376 Part 1 §17.3.1.33 (automatic paragraph spacing), §17.3.3.1
(manual break), §17.3.1.23 (pageBreakBefore) and §17.3.2.38 (font size).
These controls reject speculative twip rounding; no normative conflict or
production correction is established by this evidence.
