# User-selected font-file controls

`tools/font_file_fixture.py` authors the DOCX packages directly and derives four
TTF files from the already reviewed Source Sans Pro assets in `public/fonts`.
The derived family is **Corpus File Font**, with a new PostScript/unique name;
all glyphs, metrics and copyright/license strings remain unchanged. Table
checksums and head.checkSumAdjustment are rebuilt. No reserved font name is
used for the derivative family. The generator is the corresponding source for
these changes; upstream outline/build source and exact revisions are recorded
in `public/fonts/PROVENANCE.md` (regular/bold family and 1.075 italic faces).
Both original Adobe copyright notices and SIL OFL-1.1 licenses are included here.

`control.docx` requests that family without embedding any fonts. `embedded.docx`
uses the same text, four run styles, paragraph spacing and page geometry, with
the same four TTFs embedded and obfuscated according to OOXML. The reference application
exported `embedded-native.pdf`; `tools/record_font_files.py`
records its independent line origins and per-character PDF origins. The browser
loads the separate font files into the unembedded document and compares those
origins. This avoids installing a test font on the user's machine. It does not
claim every possible font matches the reference application.

`readonly.docx` adds an unsupported handmade1 top border to the unembedded
control. It proves presentation-only font loading remains available in protected
previews without changing the original download. It contains no ECMA art assets.

`source-hashes.json` and `reference.json` record binary identities. Browser
tests also cover edit history, undo, package-part preservation, repeat loading,
wrong filenames, invalid files and same-session reopen. Variable weight/width
metadata is tested against the existing OFL Open Sans font; TTC/WOFF containers
and named variation-instance selection remain unsupported.
