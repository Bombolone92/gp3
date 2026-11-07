# Named Open Sans faces

`tools/open_sans_alias_fixture.py` authors the source OOXML independently of the
editor. It contains Open Sans Light and Open Sans SemiBold at 12 and 18 pt,
each regular, bold, italic, and bold italic. The reference application exported
`native.pdf`; `tools/record_open_sans_aliases.py` records all 16 text origins and
384-dpi ink regions, binding source, PDF, and cases to SHA-256 values.

The engine uses the explicit static fonts from the already-reviewed Open Sans
release when the requested exact installed face is missing. See
`public/fonts/PROVENANCE.md` for pinned source, binary hashes and OFL notices.
No fonts are embedded in these DOCX fixtures or copied from the reference application's font cache.

Registering SemiBold at normal CSS weight incorrectly caused a second stroke
for DOCX bold. That first candidate measured 1.28–1.29 times the reference application's ink in the
four bold SemiBold samples. Registering the face's actual 600 weight restores
the reference application's fill-only behavior while retaining the separate synthetic advance.
All 16 final samples pass 0.2-pt baseline and 5% integrated-ink tolerances.
These are bounded rendering comparisons, not pixel or font-version identity.

The browser regression verifies lazy loading, the four explicit face assets,
preserved no-edit parts, editing, unrelated parts, exact undo, reopening, and
reusing prepared fonts. Unit coverage checks installed-face priority, concurrent
requests, sibling-family confusion, and atomic failure when italic is missing.
