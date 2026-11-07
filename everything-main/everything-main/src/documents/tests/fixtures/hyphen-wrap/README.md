# Authored hyphen wrapping

`tools/hyphen_wrap_fixture.py` manually constructs ten OOXML paragraphs, each
on a separate page, using the original table-shading fixture's package shell
and Arial 12-point default style. No template content or third-party engine is
used. `native.pdf` was exported by the reference application without saving the
source. `tools/hyphen_wrap_reference.py` extracts line assignments by PDF glyph
origins (PDF text extraction omits a newline after some line-end hyphens).
Source/PDF hashes are recorded in `reference.json`.

The reference application breaks after literal ASCII hyphens in ordinary compounds, numeric strings,
leading/negative forms and a compound split across source runs. It does not
apply this opportunity to literal U+2010 or U+2011 in these Latin controls.
The minus/short-compound cases guard against unnecessary breaks when text fits.
This is evidence of the reference application's Latin wrapping behavior, not a complete Unicode
line-breaking implementation or an OOXML requirement to use UAX #14.

Portable unit tests cover the shared intrinsic-width and paragraph rule, plus
editing, undo and caret geometry. Browser tests compare all ten line arrays
against the reference application when Arial is installed; on other hosts, editing/package checks
still run and the missing reference font is explicitly annotated. Browser
exports are separately schema-validated. Automatic hyphenation, soft-hyphen
elements and language-dependent breaking remain outside this change.
