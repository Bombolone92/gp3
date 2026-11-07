# Native column-count precedence

`tools/column_count_fixture.py` independently authors eight controls with unequal column widths of 1440 and 3600 twips, a 720-twip gap, and explicit breaks before SECOND and THIRD. It varies `w:num` (omitted, 1, 2, 3) in compatibility modes 12 and 15. No renderer output is used to author them.

ECMA-376 Part 1 §17.6.4 says the number of child `w:col` elements determines the count when `equalWidth` is false, and `num` is ignored. **The reference application diverges:** in both compatibility modes, omitted `num` defaults to one, explicit 1 also uses one, and explicit 2 uses two. Its first column retains the declared 72-point width. Consequently the three labels occupy three pages for omitted/1 and two pages for 2. `reference.json` records the reference application's document model, paragraph origins, compatibility mode, version/build and source SHA-256 hashes.

The viewer now follows that count precedence when the declared count has width entries. Its layout model contains the active entries; the package retains the entire original XML. No-edit export is byte-identical by part; text editing does not rewrite the `cols` declaration, and undo restores the package.

**Unresolved missing-width case:** explicit `num=3` with only two child entries produces a third reference column whose width is the undefined sentinel 9999999, and whose text position is -1. The reference application reports one page, retains THIRD in document text, but does not display it in the inspected window. Those two controls are recorded as evidence, not passing cases. The viewer retains its existing explicit-entry fallback for declared counts exceeding the available widths. It does not invent geometry or hide that text. Full fidelity for this case remains open.

The six unambiguous controls have unit and browser comparisons of count, page placement, origins, caret hit-testing, editable text, no-edit export, edits, undo and reopening. Schema validity alone does not establish layout equivalence with the native reference. Reference measurements are direct reference automation results, not PDF measurements; no PDF export is claimed.

To refresh native measurements after opening controls with the reference-opening helper, run `tools/record_column_count.ps1 -OpenHelper <absolute-path-to-Open-OfficeDocument.ps1>` on Windows with the reference application installed. The recorder verifies the exact opened path and reads layout data; it does not save documents or invoke PDF export.
