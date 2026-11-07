# Ordinary first-baseline controls

Original OOXML from `tools/first_baseline_rounding_fixture.py`, using only the
original automatic-spacing fixture's OPC/styles/settings shell. No corpus
text, artwork, font programs or viewer calculations are used to author it.
Compatibility mode 15 is explicit. Arial, Trebuchet MS, Times New Roman and
Garamond; 11/12/17/28/38/60pt; automatic line values 240/259/276; and regular,
bold, italic and bold-italic faces produce 288 independent pages. Each has
four short manual-break labels: 288 paragraphs, 864 breaks, 1152 visible lines.
Runs and paragraph marks declare identical formatting, with zero before/after
spacing. Page breaks isolate first-line placement at the 72pt top margin.

The reference application opened an exact-path-confirmed, byte-identical scratch copy.
A separate owned read-only instance captured actual Page.EnhMetaFileBits.
Source hash stayed unchanged and Saved remained true; its document and proven
new process were closed without saving. No existing dialog was dismissed.
`native/page-capture.json` binds all page captures. The verifier checks hashes,
600dpi headers, identity transforms, baseline alignment, logical extents,
face/weight/italic descriptors, sizes, labels and all native origins. The
bounded record inventory excludes font-program embedding. Logical coordinates
use captured Page.Width/Height; no physical glyph-raster mapping is claimed.

The browser measures two 144-page groups to retain the production 200-page
guard. Each case is independent, so splitting preserves its formatting and
native reference. It checks every absolute baseline within .2pt and relative
baseline within .12pt. The accurate 60pt Arial/Times New Roman/Garamond first
lines at 259 additionally stay within .03pt. These are regression envelopes,
not claims of perfect rendering or normative tolerances.

The proposed formula separately rounding allocation, descent and extra leading
to .12pt fails 16 first-line controls and worsens already accurate cases. It
is rejected; no production correction or normative reference/spec divergence is
established. Empty paragraphs, mixed fonts, pictures and other compatibility
modes remain separate investigations.

Regenerate with `python tools/first_baseline_rounding_fixture.py`. For new
capture, first confirm an owned scratch copy with the reference-opening helper, then use
`tools/capture_docx_page_metafiles.ps1` with ExpectedPages 288,
ExpectedParagraphs 288, WidthPt 612, HeightPt 792 and the expected source hash.
Validate with `python tools/record_first_baseline_pages.py <capture-root>
--output result.json`. Optional `--viewer <layout.json>` evaluates the rejected
candidate against measured layout. Review provenance before replacing refs.

Relevant OOXML clauses: ECMA-376 Part 1 §17.3.1.33 (spacing), §17.3.3.1
(manual break), §17.3.1.23 (pageBreakBefore), §17.3.2.38 (size), §17.3.2.1
(bold), §17.3.2.16 (italic), §17.3.2.26 (run fonts).
