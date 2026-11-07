# File fonts in metafile pictures

`tools/metafile_file_font_fixture.py` derives an independent control from our
original EMF record generator, changing only its logical font family to
**Corpus File Font**. Eight cases retain Unicode text, explicit advances, font
styles, alignments and anisotropic transforms. It contains no font parts or
corpus artwork. The four separate files in `../font-files` are renamed Adobe
Source Sans Pro fonts under SIL OFL-1.1; their corresponding source, unchanged
license notices and provenance are recorded there and in `public/fonts`.

The reference application exported the control with those four fonts temporarily loaded
through Windows AddFontResourceEx (flags zero). The export helper verifies the
source path, uses its own hidden read-only reference application instance and closes it. All
four temporary font registrations were removed in a finally block afterward;
no Windows font installation or registry entry was retained. The native PDF
selects CorpusFileFont-Regular, CorpusFileFont-Bold and CorpusFileFont-Italic
inside its picture Form resources. One italic Omega uses Calibri-Italic as
native missing-glyph fallback. The browser bound check retains the existing
EMF-control 1.6pt raster-bound limit; this is not pixel identity or proof of
matching arbitrary missing-glyph fallback.

`reference.json` binds eight glyph-bound sets to the source and private
native PDF hashes. `native.png` is the entire native page. Regenerate observations
with `tools/record_metafile_file_fonts.py PDF_PATH`. The PDF remains in scratch;
the generated controls and native measurements contain no proprietary font
binary redistribution.

EMR_EXTCREATEFONTINDIRECTW §2.3.7.8 and EMR_EXTTEXTOUTW §2.3.5.8 of MS-EMF
define the logical font and explicit text placement. See the primary links in
`../emf-text/README.md`. This change supplies the selected font to the private
image document; it introduces no reference/spec divergence and changes no source
font name, advance record, DOCX font embedding or picture bytes.

Browser checks cover native bounds, text editing, export, exact undo and
same-session reopen. Separate UI coverage loads a font after opening an EMF
document and verifies both changed picture pixels and removal of its warning.
Reloading the browser still requires reselecting the font files. Fonts with
missing glyphs still require the isolated image's fallback. OS-font catalogue
and DOCX-embedded fonts are separate paths and are not newly bridged here.
