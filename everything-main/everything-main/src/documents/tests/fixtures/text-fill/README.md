# Extended text-fill controls

Original generator: `tools/text_fill_fixture.py`. The current DOCX passes eight
schema checks and was exported by the reference application as one page after
confirming the exact source path. The initial source omitted zoom percent;
that unrelated schema error has been corrected and the PDF re-exported.

Source 118 requires w14:textFill/noFill. These controls exercise visible body
text as well as table text so support cannot silently ignore the property just
because the source's affected shape paragraphs happen to be empty.

Native findings to cover in tests: noFill retains advance/line allocation and
can coexist with a visible outline. Automatic underlines and strikes disappear;
an explicitly colored underline stays visible. Character-style noFill persists
through a direct w:color, while a direct solidFill can override it.

`empty-order.docx` isolates a native reference divergence from CT_FillTextEffect's documented
black default for an empty element: the first empty fill is black, but later
empty fills carry the preceding solid text-effect color. Ordinary foreground
color and noFill do not reset it. The reordered blue/red/no-fill/green controls
prove this across paragraphs without relying on corpus content.

`shapes.docx` covers mixed ordinary/no-fill/solid/empty text inside three separate
WPS text boxes. The reference application resets the empty-fill color for a separate text box; the
third box's target is black even though the second box contains a green fill.
The layout resolves this compatibility behavior without changing source XML.
Numbering-label and paragraph-mark effects on empty-fill color carry have not
been independently established.

`decorations.docx` isolated an underline-metrics discrepancy. Native
Arial 18pt single underlines are 1.32pt thick for ordinary, no-fill, solid and
empty text effects alike; the engine previously used .9pt. This was not caused
by fill selection. The native-font underline correction now uses Arial's post
metrics (150/2048 em), and the browser check includes native ink area without
the former rule-thickness exception. See [native underline controls](../native-underlines/README.md)
for the independent measurements, supported families and remaining pattern gaps.

All four original DOCX files were exported by the reference application.
`tools/text_fill_reference.py` records PDFium character origins and native ink
bounds/counts, with SHA-256 source/PDF identities, in `reference.json`.
The browser comparison checks each line's black/red/green/blue/teal ink, including
absence of unwanted glyphs and presence of explicit underlines and outlines.
Two-pixel boundary and raster-area tolerances accommodate PDF/browser rasterizers;
these are not pixel-identity assertions. Edit/export/reopen and exact undo are
checked separately. Gradients and transformed solid colors remain unsupported.

Primary reference: [Open XML SDK FillTextEffect / CT_FillTextEffect](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2010.word.filltexteffect?view=openxml-3.0.1),
which reproduces the extension definitions and points to ISO/IEC-29500-1
§17.3.2.6 for ordinary text color. No third-party implementation was used.
