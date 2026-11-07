# Persistent block-control behavior — paragraph editing increment

Original OPC/XML authored by tools/persistent_block_control_fixture.py. No corpus
artwork, text or fonts are included. tools/record_persistent_block_controls.ps1
opens the exact source read-only in an owned hidden reference-application instance, applies
Range operations to named content controls, saves a separate edited package,
exports before/after PDFs and closes its instance. These are reference object-model
operations, not a claim about every keyboard selection/boundary behavior.

The reference application retains every block wrapper after insertion, replacement, partial
bold formatting, replacing a showing-placeholder cache, explicit temporary=false,
and replacement across two paragraphs. Inserting a paragraph break creates two
paragraphs inside the same wrapper. Deleting all contents retains one paragraph
and restores a showing-placeholder cache containing five spaces. The edited XML
still places every sdt at body level. The results and native packages/PDFs are
recorded with hashes; rendered before/after pages were visually inspected.

The original app rejected this control and source 137. Paragraph-based persistent
block controls now retain their wrappers through the recorded core edits, search
replacement, undo and reopen. A block may contain one or more paragraphs and
supported inline controls. Browser tests cover placeholder entry, deletion,
restoration and paragraph splitting. Source 137 is now editable.
Relevant ECMA-376 Part 1: 17.5.2.29 (sdt), 17.5.2.34 (block sdtContent),
17.5.2.39 (showingPlcHdr), and 17.5.2.43 (temporary). No reference/spec divergence
is claimed.

The initial implementation guarded wrappers around tables, nested blocks and
cell-level content. Nested paragraph blocks now have independent evidence in
`../nested-persistent-blocks`; cell wrappers have their separate controls.
Persistent wrappers around tables remain read-only. The implemented outer-edge
join subset is recorded in `boundary-matrix/`: The reference application converts a surviving
single-paragraph rich-text wrapper to inline form, while multi-paragraph wrappers
retain their outer paragraph boundaries. Cross-boundary insertion has different
ownership at the start and end; tests compare the native text and saved wrapper
structure through editing, export, reopening and exact undo.

Erasing all contents across the start can leave an empty inline wrapper. That
representation and subsequent prompt restoration are supported; see
`../empty-inline-controls`. Complete wrapper selection is distinct from selecting
all text inside it. Native Range offsets include invisible control boundaries
and must not be treated as raw visible-text offsets.

Remaining boundary guards are explicit in `persistentBlockBoundary` in
`src/engine/block-controls.js`: multiple intersected surviving controls, nested
controls, cell/plain-text controls, scoped bookmarks or fields, multi-paragraph
glossary prompts, and joins reaching deeper internal paragraphs. Partial
cross-boundary replacement of a displayed placeholder is rejected by the reference application too.
These limitations do not mean ordinary outer-edge joins are unimplemented.
