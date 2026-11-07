# Formatted cached nested-field results

Generate the original source with `python tools/toc_pageref_fixture.py --formatted`.
It extends the original `toc-pageref` control with 16pt purple italic Times New
Roman labels from a custom character style and 14pt green bold Courier New
PAGEREF results from direct formatting. The PAGEREF fields are locked so the
native export measures cached-result formatting rather than regenerated values.
An initial unlocked probe showed the reference application refreshing those results using instruction
formatting; it is not the oracle stored here.

The reference application opened the source read-only and exported this four-page PDF
without saving. `tools/reviewed_font_reference.py toc-pageref-formatting` records
glyph positions and source/PDF hashes. The fixture uses installed system fonts,
contains no embedded font files and copies no corpus content.

The browser test compares native text, origins and baselines within 0.3pt,
checks painted font/color choices and requires an exact original-byte download.
Both source XML parts and the downloaded package pass schema validation. Cached
TOC/PAGEREF results are now editable; browser regressions cover entry edits,
nested-result deletion/refill, splitting, export/reopen and exact undo.
Field updating remains outstanding.
