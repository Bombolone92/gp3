# Font-specific symbols in page stories

`tools/story_symbols_fixture.py` authors three source/literal pairs using the
project's original mixed-picture XML and artwork helpers. Wingdings F031,
Symbol F0E3 and Arial 0061 occur before, after or on both sides of pictures in
styled hyperlink runs. Each document includes body, table-cell, header and
footer occurrences. No corpus content or redistributed font files are included.

At `c1ae9864`, all three source controls fail strict import with `sym`; their
best-effort previews omit the header/footer glyphs. The shared symbol reader
already handles body and drawing text, but excludes page-story runs. Removing
that context exclusion uses the same validated font/code atom, layout, font
preparation and serialization path in headers/footers. It does not reinterpret
symbols as ordinary text or change their explicit font when editing the run.

ECMA-376 Part 1 (2016) §17.3.3.30 defines the explicit symbol font/character pair
inside a run; page-story runs do not change that meaning. Existing body-symbol
controls retain direct/PUA, missing-glyph and capitalization behavior. No new
reference/spec divergence is claimed by this extension.

`native.pdf` was exported from `before-symbol.docx` through the reference application's Save
As PDF interface, standard quality, without saving changes to the source. The
full page was visually inspected. `tools/record_story_symbols.py` binds the
source/PDF hashes and records all four glyph advances from character origins,
subtracting the following picture's authored width. The header, footer, body
and table all give 18.84 pt for this 14 pt bold Wingdings glyph. Native font
availability is required for the browser's 0.2 pt advance check.

The pairs also compare complete browser pages against equivalent explicit-font
literal glyph runs. The literal controls are rendering comparators, not symbol
editing models. Native comparison isolates the glyph advance: this fixture's
unspecified surrounding font can differ between the reference application and the browser, and full
surrounding text typography is not certified by this reference.

Unit/browser checks cover strict import, symbol/picture retention, header/footer
editing, adjacent typing, replacement, formatting, exact original/no-edit and
undo package preservation, unrelated-part preservation and edited reopening.
Malformed symbols retain the existing validation. Font availability and other
independent page-story restrictions remain unchanged.
