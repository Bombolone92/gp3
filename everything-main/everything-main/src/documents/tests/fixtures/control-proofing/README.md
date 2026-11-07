# Proofing annotations inside content controls

`tools/content_control_proofing_fixture.py` independently authors five controls:
temporary rich-text placeholder and existing text, temporary plain-text
placeholder, a temporary rich-text hyperlink, and persistent rich text.
Each contains paired spelling and grammar markers. No corpus content is used.
The generator uses permissively licensed python-docx and lxml.

`native.pdf` was exported from this exact source in the reference
application. It has one page; proofing markers add no printed text or layout.
This is standard OOXML support, not a claimed reference/specification divergence.
See ECMA-376 Part 1 §17.13.8.1 (`proofErr`) and the documented
[inline control content children](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sdtcontentrun?view=openxml-3.0.1).

The reader accepts spellStart, spellEnd, gramStart and gramEnd annotations in
supported inline text controls, including their text hyperlinks. It validates
their attributes and empty contents. An unchanged control retains its complete
source shell; ordinary temporary/persistent control edit semantics still apply.
Proofing annotations do not imply support for locked controls, data bindings,
unsupported fields or other control types.

Unit coverage checks imports, package retention, editing each kind, formatting,
reopening, exact undo and malformed-marker rejection. Browser coverage exercises
actual typing into all five controls, export/reopen, exact package undo and
canvas restoration.

Validation: 111 focused unit tests and 19 browser cases pass; one optional
private corpus case is skipped. The source, 38 exports from the broad browser
run and 10 final proofing exports pass schema checks. Production build and its
license gate pass. `reference.json` binds the native PDF to its source hash.
