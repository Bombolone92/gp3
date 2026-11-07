# Editable quarter-turn cells and table-style compatibility

Direct `w:tcPr/w:textDirection` values `lrTb`, `btLr` and `tbRl` now use
the existing layout, painter, pointer/keyboard selection and editing paths
through strict DOCX import. Newly authored cell shells retain explicit
directions, including horizontal overrides. Unsupported rotation structures
(hidden terminal marks, nested tables inside a rotated cell, or a rotated
cell split across pages) still fall back to read-only display. This does
not add a direction picker or implement East Asian vertical text modes.

## Independently reproduced reference divergence

ECMA-376 Part 1 sections 17.4.72, 17.7.6.8 and 17.7.6.9 allow table-style
direction declarations and describe inherited cell text flow. The reference application ignores
these declarations in table styles. The published MS-OI29500 implementation notes document
the restriction for [conditional cell properties](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/348cf5dd-492c-4e2b-9fe3-c4996f8c52e5)
and [base cell properties](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/9e742550-b438-4b9d-9606-4ae34d83830f).

`tools/cell_text_direction_styles_fixture.py` constructs four original paired
controls in `styles.docx`: conditional directions, a base direction, a basedOn
chain, and direct cell directions. Each styled table has direct horizontal
and rotated overrides. The reference application produces four pages:
the first three have identical text orientations; only the directly rotated
cell rotates. On the fourth page, all direct rotations take effect.
`styles-native.pdf` and the hash-bound `styles-reference.json` retain
native text matrices and border bounds.

The engine now follows this reference behavior. Ignored style declarations remain
in the untouched styles part; they are neither deleted nor copied into cells
on topology changes. The previous preview's style-direction inheritance was
incorrect for reference compatibility. Conditional borders remain active.

Regeneration, from the repository root:

```powershell
python tools/cell_text_direction_styles_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/styles.docx" -OutputPdf "$PWD/tests/fixtures/cell-text-direction/styles-native.pdf"
python tools/record_cell_text_direction.py styles
```

Unit and browser checks exercise import validation, direct and ignored style
directions, inserted rows with new shells, rotated typing/navigation,
edited export/reopen, unrelated-part preservation and exact undo. Browser
native comparisons retain the existing 0.15pt X / 0.2pt Y tolerances.
The automatic-line baseline differences in `height` and `origins` remain
explicit expected failures; editable import does not resolve or conceal them.
