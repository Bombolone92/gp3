# Nested persistent block controls

Original XML fixture from `tools/nested_persistent_block_fixture.py`, using the
repository's original minimal package skeleton. Seven independently named
outer/inner pairs cover insertion, inner deletion, paragraph splitting,
outer replacement/deletion, a temporary child and a temporary parent. There
is no corpus content, artwork, added font or third-party document engine.

`tools/record_nested_persistent_blocks.ps1` opens the exact fixture read-only
in its own hidden reference-application instance and applies Range operations to named controls.
The reference application preserves both wrappers for inner insertion/splitting,
restores only the inner placeholder on inner deletion, and removes the inner
wrapper when the complete outer contents are replaced or deleted. Editing a
temporary child removes that child while preserving its persistent parent.
Editing a persistent child leaves its temporary parent intact.

`reference.json` records each result and source/Flat OPC hashes;
`native-edited.xml` is the reference application's in-memory Flat OPC after all seven edits, not a saved
DOCX. The tests compare model and reopened package ownership, contents and
placeholder state against these native observations, and verify exact undo.
Additional tests cover search replacement, atomic partial-boundary rejection
and tables hidden beneath a temporary child of a persistent parent.

The read-only native PDF was exported after repagination with
`tools/export-reference.ps1`. Both full-size reference/editor page pairs were
visually inspected. PDF SHA-256:
`e956c5f6ed87ccfad1dfc3c22a5e142098ae027d50831903e1251a13345ed3f0`.
The browser test exercises nested placeholder deletion/re-entry, preserved
outer/inner XML, unrelated parts, no-edit and undo preservation, and reopening.

ECMA-376 Part 1 §§17.5.2.29 and 17.5.2.34 allow nested block structured-document
tags; §§17.5.2.39 and 17.5.2.43 govern placeholders and temporary wrappers.
The recorded behavior needs no exception to those clauses. Persistent wrappers
containing tables and partial boundary joins remain separately guarded.
