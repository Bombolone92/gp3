# Held-out section origins and row dimensions

`tools/print_section_phase_fixture.py coordinate --output-folder FRESH_DIRECTORY`
authors 80 textless, next-page sections independently of the renderer. Letter
pages combine top margins 719, 721, 4456 and 7754 twips; exact row heights 398,
402, 406 and 407 twips; and single borders 3, 5, 8, 12 and 16 eighth-points.
The table grid is 4320 twips and cell/header/footer margins are zero.

The byte-identical private source was opened with the reference-application helper. The reference application
displayed Saved and 80 pages. Read-only `capture_print_section_metafiles.ps1`
captured the existing visible document, checked its source hash before and
after, and retained private page metafile hashes. The rectangle recorder
retains only numeric PATCOPY destinations, clips and device metadata. No font
program or bitmap resources are committed. There is no PDF capture for this
control; raw coordinates do not establish PDF or screen placement.

Source SHA-256:
`02a61f9426c7e17d1b74a1553cbb39f8fa91fd5c9d254f39d200711e5e17dd8b`.
All 80 pages have twelve unclipped blue rectangles at the 600dpi reference
grid. Native references remain separate from the authored source/case bytes.
The independently held-out origins reject four arithmetic paths that matched
all 156 earlier raw far-edge observations.

Relevant declarations are ECMA-376 Part 1 §§17.6.11 (`pgMar`), 17.4.80
(`trHeight`), 17.18.37 (`ST_HeightRule`), 17.4.38/66 (`tblBorders`/`tcBorders`)
and 17.3.4 (`CT_Border`). The specification specifies dimensions and border
semantics, not the consumer's floating-point or printer-grid conversion.
These observations do not establish a specification divergence.

`native-row-layout.json` separately records native row/cell height properties and
cell-range positions from the same source. Two read-only observations reproduce
all eighty records. These API values are not painted border bounds: the range
positions are coarse and the exposed height precision does not establish an
internal layout algorithm.
