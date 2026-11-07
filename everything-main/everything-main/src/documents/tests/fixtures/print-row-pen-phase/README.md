# Exact row heights across physical pen widths

`tools/print_row_pen_phase_fixture.py --output-folder FRESH_DIRECTORY` authors
80 isolated next-page sections with standard-library OOXML/ZIP operations.
Each has a 4320-twip grid, zero cell margins, a 396–411-twip exact row, and
3/8, 5/8, 8/8, 12/8 or 16/8pt single borders. It refuses to overwrite captures.
The source contains no visible text or font programs.

The reference application opened the exact source through the reference-application helper and displayed 80 pages
and Saved state. File > Export > Create PDF/XPS at Standard quality produced a
private native PDF. `tools/record_print_row_pen_phase.py PRIVATE_PDF OWNED_DOCX`
verifies the captured source hash, then records native rectangle bounds and
reconstructs a geometry-only PDF with active rectangular clips retained. It
does not read or copy font programs. The native source PDF hash is retained.

`tools/test_print_row_pen_phase.py` verifies source/cases/PDF hashes, all 80
authored row/border declarations, all 960 blue rectangles and their native
bounds. Forty cases overlap the earlier independently captured row-width and
row-phase controls; the remaining forty expand their coverage. The 396-to-402
twip increment moves the native far edge by .24pt for a 3/8pt pen, but .36pt
for a 5/8pt pen. Thus independently rounding the row height then adding a
constant border offset cannot explain native placement.

These are native consumer painting observations for ECMA-376 Part 1
§§17.4.80 (`trHeight`), 17.18.37 (`ST_HeightRule`), 17.4.38/66
(`tblBorders`/`tcBorders`) and 17.3.4 (`CT_Border`). Authored dimensions stay
intact; the specification does not prescribe these PDF rounding phases.
Horizontal frame placement and edit/save/undo/reopen are passing requirements.
Vertical placement retains its explicit expected failure after the structural
and horizontal checks. No production renderer change or corpus promotion is
claimed.

On October 10, read-only page metafile capture observed the same saved source
and all 80 Letter pages. `native-metafile-rectangles.json` retains numeric raw
PATCOPY destinations, clipping and private metafile hashes, without copying
native font/bitmap resources. All 80 top/far bounds agree with this control's
PDF bounds on the .12pt reference grid; that agreement is not assumed for
other controls. A float-factor hypothesis was rejected by four raw counterexamples.
