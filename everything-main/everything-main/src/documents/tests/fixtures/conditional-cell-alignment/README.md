# Conditional cell vertical alignment

Original OPC/XML controls authored by `tools/conditional_cell_alignment_fixture.py`;
no corpus document or third-party engine was used to generate them. Each file has
nine pages covering unconditional top/center/bottom/absent alignment, first-row,
first-column, horizontal-band and northwest-corner conditions, and direct top and
bottom overrides. All rows are exactly 40pt high; text uses installed Arial 12pt.
Yellow shading independently identifies the conditional region.

The three sources differ only in explicit compatibility modes 12, 14 and 15.
The reference application exported each source read-only to its corresponding PDF.
`tools/record_conditional_cell_alignment.py` records PDF character origins and
SHA-256 hashes of the source and native reference. The PDF is the independent
oracle, never output from the application.

ECMA-376-1 fifth edition §17.4.83 defines cell `vAlign`; §17.7.6.6 defines
conditional table formatting. In mode 15 the reference application diverges from normal conditional
override behavior: an unconditional center/bottom cell alignment wins over the
conditional alignment. An unconditional top or missing value permits the
conditional value. Direct cell formatting still wins. Modes 12 and 14 retain
conditional precedence. The application implements this mode-15 distinction.

Known separate gap: in modes 12/14, the reference application applies the first-column alignment in
C04 to both cells of each row, and the northwest-corner alignment in C06 to both
cells of row zero, even though shading remains confined to the selected cells.
The application still limits these alignments to the selected cells. Browser
native-Y assertions explicitly exclude these six legacy observations out of
108 total; all X positions and the other 102 baselines are checked within 0.3pt.
These controls retain the gap for further investigation rather than claiming
complete legacy fidelity. All 27 native/application page pairs were inspected.

Tests also cover direct alignment changes, column insertion, style preservation,
exact undo, browser editing, export and reopening. No layout loop or measurement
pass was added: compatibility precedence is resolved during table import and
existing conditional-style refreshes.
