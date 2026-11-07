# Paragraph-mark line metrics

`tools/paragraph_mark_metrics_fixture.py` manually authors original Arial
controls with 12pt text and 12pt/24pt paragraph marks. The reference application exported `native.pdf` without saving changes to the DOCX. The source
has no compatibility settings. `tools/reviewed_font_reference.py
paragraph-mark-metrics` records source/PDF hashes and independent PDF glyph
origins. The full reference page was visually inspected.

The body paragraph and ordinary/hidden table cells containing text retain
the same 13.8pt line advances whether their marks are 12pt or 24pt. Both the
first and last cell paragraphs are covered. Empty, spaces-only and tab-only
paragraphs use the 24pt mark's 27.6pt line height. A terminal manual break
likewise leaves an empty 27.6pt line after the 13.8pt text line. The old
renderer applied the oversized mark to text lines too, adding over 55pt of
vertical drift by the end of the original body/table control.

ECMA-376 Part 1 §17.3.1.29 (printed pp.243–244, PDF pp.253–254) assigns `pPr/rPr`
to the paragraph-mark glyph, separate from text runs. §17.3.1.33 describes
line spacing. Neither explicitly defines this invisible mark's contribution
to nonempty-line allocation. This control documents the reference application's behavior rather
than claiming an explicit normative contradiction. The engine now excludes
the terminal mark when the line has text; whitespace-only and empty lines,
manual-break run metrics and image-only minimum-height rules remain distinct.
The stored mark formatting is not changed.

The browser oracle checks all printed text and baselines within 0.15pt, native
editing, unchanged package export, unrelated-part preservation, undo and
reopening. Unit controls also cover trailing whitespace, manual-break font
sizes and deleting text then restoring it with undo. Both full reference/browser
pages were visually inspected. The browser's second table column sits about
5.4pt to the right of the reference application's in this control with implicit cell margins; that
separate horizontal table-position issue remains open. This oracle verifies
vertical allocation, not complete table geometry.

Validation: 109 unit tests and 21 browser cases pass, including existing
reference baseline, inline-object, numbering and hidden-cell references. The source
and browser/template exports pass 70 XML checks; build/license checks pass.
