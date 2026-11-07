# Native fixture provenance

Original DrawingML controls produced by `tools/anchor_offset_precision_fixture.py`
(with `--containers` for the companion). Existing original OPC boilerplate is
reused; the engine serializer is not involved. Each file has four pages and 64
rectangles. The companion uses groups on its first two pages and single-cell
tables on its last two. Margins are 96pt; each table follows a 1pt empty paragraph.

Private identical copies were opened with the reference-opening helper and confirmed by
exact path. The reference application showed four pages without repair. Native Save As
PDF used Standard quality. `tools/record_anchor_offset_precision.py <work-dir>`
checks package identity and records 128 stroked 24×18pt rectangles, rejecting
unexpected PDF transforms. PDF files contain only this original control artwork.

All positions match signed offset truncation to whole twips before adding the
reference origin: `Math.trunc(EMU / 635) / 20` points. Cases cover positive page
and margin offsets, negative and positive margin offsets, column/paragraph
origins, groups, and physical-cell placement. Group child coordinates are not
quantized by this rule. A cell's 1pt origin displacement remains independent of
the numeric offset. Pen widths and dimensions remain unchanged.

ECMA-376 Part 1 §§20.4.2.12 and 20.4.3.3 specify EMU offsets. The truncation is
reference layout compatibility behavior; source EMUs must be preserved. Alignment,
percentage positions, inline dimensions and DrawingML child transforms are not
covered by this conversion. Header/footer layout uses the shared positioning
function; no new native story fixture is claimed here.

Tests compare all native rectangle positions, sizes and hit testing, retain
original package entries, and check edited export/reopen and exact undo. See
also the independent curve boundary fixture in `../outline-curve-display`.
