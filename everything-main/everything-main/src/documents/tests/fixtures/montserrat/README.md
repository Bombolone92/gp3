# Montserrat family and Light faces

`tools/montserrat_fixture.py` authors independent OOXML with 24 cases: Montserrat
and Montserrat Light at 10, 12 and 18 pt, each regular, bold, italic and bold
italic. The reference application exported `styles.docx` to `native.pdf` (one page).
`tools/record_montserrat.py` records text origins and 384-dpi ink measurements;
its manifest binds source, PDF and cases to SHA-256 hashes.

The six unmodified public font assets come from the official Montserrat v7.200
source revision documented in `public/fonts/PROVENANCE.md`, under OFL-1.1.
No font binary from the reference application is shipped. DOCX fixtures contain no embedded fonts.
Installed fonts retain priority; missing requested families load same-origin
assets on demand. The exact Light alias is separate from the ordinary family.

Browser checks retain the existing 0.2-pt baseline and 5% ink bounds, exercise
no-edit export, insertion, preservation of other parts, exact undo and reopening,
and verify no eager or repeated font requests. Unit tests cover native priority,
concurrent requests, sibling substitution and atomic failure of a required face.

Original corpus #120 improves visibly in body wrapping and placement, but remains
partial because its Sagona title is unavailable. The earlier theme-bold suspicion
was ruled out by the independent montserrat-theme controls and matched-scale
original comparison. These
controls do not certify all glyphs or pixel equivalence.
