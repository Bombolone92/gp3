# Automatic paragraph spacing: original reference controls

`tools/automatic_spacing_fixture.py` manually authors seven small OOXML packages.
The fixtures contain original labels and geometry, without user template assets.
Each input was opened in the reference application on this VM, confirmed by its exact full
path through the reference application's automation model, exported to PDF, and closed without saving.
All regenerated ZIP entries were checked byte-for-byte against the inputs opened in the reference application.
`reference.json` records PDF hashes and text baselines in points from the
page top. PDF coordinates have approximately 0.12pt quantization; browser tests
allow less than 0.3pt in relative baselines. There are 22 reference pages.

- Legacy and modern: 10pt/20pt Arial, automatic true/false, body and table
  paragraphs, competing point and line-unit declarations. The reference application uses 14pt for
  automatic spacing independently of these font sizes and compatibility modes.
- Fixed: the same paragraphs with `doNotUseHTMLParagraphAutoSpacing`. The reference application uses
  the explicit 24pt/36pt line-unit gaps instead, adding adjacent gaps.
- Boundaries, modern/fixed: first body paragraph, empty paragraph, first/last
  table-cell paragraphs, omitted, zero and nonzero explicit point spacing.
- Lists and list boundaries: nesting, separate instances of the same abstract
  definition, distinct decimal and bullet definitions. Automatic gaps disappear
  within one definition and remain between distinct definitions.

ECMA-376 Part 1 §17.3.1.33 makes automatic spacing override point and line-unit
declarations and leaves the HTML-like amount to the consumer. The 14pt choice
is measured reference behavior, not a specified universal constant.

**Proven reference/specification divergence:** Part 4 §14.8.3.15 specifies 5pt before
and 10pt after for automatic spacing with `doNotUseHTMLParagraphAutoSpacing`.
The reference application instead ignores the automatic flags, uses the inherited/explicit gaps,
and adds neighboring before/after gaps, including paragraphs without automatic
flags. In `automatic-spacing-boundaries-fixed.docx`, the Auto/Zero pairs have
12pt baseline increments (zero gap); Point/Plain pairs have 27pt increments
(12pt line + 5pt before + 10pt after). In the fixed line-unit control, table
baseline increments are 72pt (12 + 24 + 36). This rules out implementing the
specified fixed 5pt/10pt substitution or retaining ordinary maximum collapse.

The renderer follows these original reference controls. Source flags and competing
measurements remain intact on unchanged export. Explicit point edits disable
the affected automatic flag; clearing direct formatting restores inheritance.
The compatibility flag remains a retained document setting.
