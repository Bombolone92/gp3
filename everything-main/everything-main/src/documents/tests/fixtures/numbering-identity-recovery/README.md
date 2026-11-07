# Local recovery of rejected numbering identities

Generate with `python tools/numbering_identity_recovery_fixture.py`. The generator
uses the project's independently authored `numbering-definition-recovery/format.docx`
and original small PNG, not a corpus document, external artwork or another engine.
ZIP timestamps are fixed. The matched visual control is
`../numbering-definition-recovery/healthy.docx`.

The eight variants independently introduce duplicate abstract/instance identities,
missing or nonnumeric IDs, an instance with the existing rejected zero ID, and
simultaneous duplicate abstract and instance IDs. Healthy list items surround rich
affected paragraphs in the main story, a table cell and a header. Duplicates have
conflicting definitions so choosing the first or last is not safe recovery.

Strict import must still reject these records. Read-only import omits unidentifiable
records and marks duplicate identities unavailable, preserving independent lists,
styles, pictures and tables. References to affected definitions lose only their list
participation through the existing definition recovery. No synthetic identity or
replacement definition is introduced. Original download bytes remain unchanged;
edited export is unavailable. Invalid/ambiguous style backlinks are not silently
reinterpreted as valid aliases.

This is defensive preview behavior, not a claim that malformed input is conforming
OOXML or that the reference application repairs it the same way. ECMA-376 Part 1 §17.9 defines the
numbering/abstract numbering identities and references. XSD validation correctly
rejects four numbering parts with missing/nonnumeric IDs. It accepts the other
parts, including duplicates and zero; an XSD pass does not establish identity
uniqueness or active list semantics. All 28 other XML views pass validation.

Unit checks cover preserved counters, rich runs, source parts, strict rejection,
blocked editing, unused malformed identities, linked styles and numerically equal
IDs with different lexical forms and declaration order. Browser checks compare
every recovered canvas and text geometry against the matched healthy control,
verify issue messages, and download the original bytes.

A browser comparison against `4b383f6a` verifies the old reader loses all list
markers for the combined control. The candidate restores the independent `1.`
and `2.` items and the header list, matching the healthy control's complete canvas.
The valid control and corpus #353 retain identical before/after canvases. The latter
remains partial because decorative page-border artwork is not implemented.
