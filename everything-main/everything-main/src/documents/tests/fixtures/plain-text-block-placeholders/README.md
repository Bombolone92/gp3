# Multi-paragraph plain-text placeholder caches

Original controls generated with `tools/plain_text_block_placeholders_fixture.py`
using python-docx (MIT), lxml (BSD) and standard-library OPC/ZIP operations.
No corpus XML or artwork is included. Eight isolated `*-source.docx` files test
body/table-cell placement, temporary/persistent lifetime, placeholder/real
content, multiLine true/false and mixed formatting. `source.docx` is the combined
authoring probe; the reference application rejects it because it includes invalid real-content cases.
All nine source packages pass schemas, illustrating the difference between
schema validity and the semantic constraints on plain-text controls.

The reference application accepts all five placeholder cases as plain-text
controls (COM type 1), preserving three paragraphs, even with multiLine false
or mixed run formatting. It rejects all three ordinary-content cases as
corrupted. This is an observed placeholder-cache exception to the paragraph/run
constraints in ECMA-376 Part 1 §17.5.2.44, read alongside §§17.5.2.34 and
17.5.2.39. It does not authorize multi-paragraph actual plain-text values.

`tools/plain_text_block_placeholders_native.ps1` opens each exact isolated source
in its own document within an owned hidden reference-application instance. It records no-edit
inspection, partial-selection bold and interior typing. Selection-based bold
formats all three paragraphs and retains the wrapper. Interior typing replaces
all three paragraphs with one; temporary wrappers disappear and persistent
wrappers remain. Preliminary Range.Font formatting did not persist the prompt
change and was superseded by the recorded Selection.Font operation, consistent
with the earlier plain-text-control fixtures.

`native-edits.json` records native observations. Five PDFs and fifteen saved native
packages preserve the results; `reference.json` records per-source and
native-file hashes. Refresh the manifest with
`tools/record_plain_text_block_placeholders.py` only after native recapture.

The editor supports these cached text paragraphs in its existing temporary
block/cell-control lifecycle. Persistent block controls remain read-only; the
native persistent cases document that separate remaining capability. Unsupported
nested controls, tables and non-text runs are not admitted by the exception.

Validation: 63 focused unit tests and 17 browser cases pass. The nine sources,
fifteen native saved packages and all 44 browser exports pass schemas. Production
build and its license gate pass. Tests cover mixed-cache formatting, whole-cache
replacement, cell placement, exact package undo, unrelated-part preservation,
editable reopen and continued rejection of unsupported real content.
