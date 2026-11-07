# Branch-owned temporary placeholder references

The two DOCX controls are independently authored by
`tools/drawing_text_placeholder_refs_fixture.py`, using the original WPS/VML
alternate-frame generator. They reproduce byte-for-byte and embed no fonts,
artwork, or third-party engine output.

Both branches cache identical rich text with the same content-control identity
and formatting. Their placeholder references are `ModernPrompt` and
`LegacyPrompt`, with neither definition included. `temporary.docx` expires the
wrapper when content changes. `persistent.docx` retains it and remains guarded
because its different placeholder definitions could affect later editing.

Relevant ECMA-376 Part 1 clauses are §17.5.2.25 (`placeholder`), §17.5.2.39
(`showingPlcHdr`), and §17.5.2.43 (`temporary`). This is a source-correspondence
fix, not a reference/spec divergence. Matching cached temporary contents does not
require replacing, resolving or synchronizing the branch-owned prompt names.

The reference application opened the exact independent scratch copy through the reference-opening
helper. The visible text frames were observed. Detached formatting retained the
temporary placeholder; replacing its contents removed the wrapper. Saving to a
fresh separate reference left the original bytes unchanged. `native-edits.json`
records those observations, bound to source SHA-256
`3796ac924cf105c8a445ce6b932f22dc3271d32474b67b6d4f99cb6c58b917b6`.
The native saved DOCX stays private; it passed the supported schema views.

Unit tests check formatting preservation of both references, temporary lifetime,
save/reopen and exact package undo/redo. Persistent definitions, false/invalid
temporary flags, empty reference values, unknown attributes, differing control
identities and differing cached text remain distinct. Browser coverage exercises
the real context menu and drawing-text dialog, including apply, repaint, cancel,
export and exact undo.

The production matcher tries exact correspondence first. Only unmatched
temporary-control stories need a disposable comparison projection; original
source XML remains untouched. The target journal's
eight page rasters remain identical before and after this editing fix. Its other
visual gaps are not declared complete.
