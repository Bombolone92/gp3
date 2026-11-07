# Reviewed fonts inside EMF pictures

`tools/metafile_reviewed_font_fixture.py` changes only the logical font family
in our independently authored eight-case EMF text control to Karla. Unicode
characters, explicit advances, alignment, style and anisotropic transforms
remain unchanged. This contains no corpus artwork or font parts. Karla Regular
and Bold are existing, unmodified OFL resources; corresponding source and
license provenance remain in `public/fonts/PROVENANCE.md`.

The reference application exported this one-page control with those two fonts temporarily
registered using AddFontResourceEx, flags zero. The helper used its own hidden,
read-only reference application instance and removed both registrations in a finally block.
No font installation or registry entry remains. Native Form resources select
Karla-Regular and Karla-Bold. Synthetic italic uses Karla-Regular with a
one-third shear; this control's Omega does not use another font.

The bridge gives isolated image SVGs the reviewed same-origin font bytes
already used by body text. Installed alternatives and explicitly supplied
files retain priority. A failed or incomplete family fetch retains its warning
and existing fallback; a later attempt can retry. Source picture bytes,
logical family names and DOCX parts are preserved.

Static supplied faces use OS/2 Windows ascent/descent for top/bottom alignment.
When a real italic face is unavailable, each explicit glyph origin receives
the reference application's observed one-third shear. This is compatibility with the recorded reference
playback, not a normative fixed shear mandated by OOXML or MS-EMF. Real italic
faces retain their outlines. Variable or unreadable metrics retain the prior
baseline approximation. Full font substitution, decorated synthetic italic,
complex scripts and arbitrary EMF text modes need further independent cases.

`reference.json` retains PDF character boxes and independently measured
painted blue-ink bounds at 384 dpi. PDFium's transformed character rectangle
overestimates synthetic italic ink (right edge 169.658295pt versus painted
167.625pt); character boxes are not the painted-path oracle. The browser checks
all 32 painted edges with the existing 1.6pt raster tolerance. Source and native
PDF hashes bind these observations; `native.png` is the entire native page.
Regenerate with `tools/record_metafile_file_fonts.py PDF_PATH
tests/fixtures/metafile-reviewed-fonts --pixel-bounds`. The private PDF hash is
72d84fd92f462d2628f95fbc97a448de3178d533f870ce49f185f6b8e0035887.

Browser checks also compare automatic and explicitly supplied faces pixel for
pixel, then verify text editing, untouched package parts, exact undo and
reopening the export. An optional private corpus source exercises the same
preservation checks without shipping its contents.

Format references are MS-EMF §2.3.7.8 (EMR_EXTCREATEFONTINDIRECTW), §2.3.5.8
(EMR_EXTTEXTOUTW), and §2.2.5 (EmrText); see `../emf-text/README.md` for primary
links. GDI metric context: [TEXTMETRICW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-textmetricw)
and [LOGFONTW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-logfontw).
These controls establish a supported subset, not complete EMF or reference equivalence.
