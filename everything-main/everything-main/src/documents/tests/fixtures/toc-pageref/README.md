# Nested TOC and PAGEREF controls

`tools/toc_pageref_fixture.py` manually authors this original four-page DOCX.
It contains no corpus content, embedded fonts or third-party document engine.
Arial is selected from the installed system fonts.

The first page contains a TOC field spanning three paragraphs. Each result is
an internal hyperlink with a nested PAGEREF field. Three bookmarked Heading 1
paragraphs start on pages 2, 3 and 4. An independent PAGEREF targets page 3;
ordinary text follows the TOC to exercise its closing boundary.

The reference application opened the source read-only and exported `native.pdf`
without saving the document. The PDF contains four pages with the authored
cached results 2, 3, 4 and 3. This export establishes native rendering, not
evidence that the reference application regenerated the TOC. `tools/reviewed_font_reference.py
toc-pageref` records glyph origins and SHA-256 hashes of the source and PDF.
The document and styles parts pass the ECMA-376 transitional schema.

The app now renders four editable pages with exact no-edit ZIP parts. Cached
results can be edited without discarding field instructions. Explicit updating
remains outstanding.

Relevant ECMA-376 Part 1 clauses: 17.16.5.45 PAGEREF, 17.16.5.68 TOC and
17.16.18 fldChar. The body reader now retains multi-paragraph nested results,
switches, hyperlinks and bookmarks. `tools/record_cached_toc_edits.ps1` records
five reference range edits: manual entry, edited/empty page reference, renamed heading
and split entry. Tests also import native edited XML. The reference application's Fields collection
includes surrounding hyperlinks, so the recorder selects PAGEREF by its code.

A split hyperlink becomes a complex HYPERLINK field across paragraphs in the reference application.
That form is supported alongside explicit wrappers; see `../hyperlink-fields`.
Heading edits retain cached TOC text. Regeneration and layout-based page-reference
refresh remain outstanding.
