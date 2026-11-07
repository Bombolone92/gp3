Read-only native metadata for two existing independently authored controls:
`border-axis-phase/control.docx` (128 tables, two border widths, four exact
heights) and `border-dense-phase/control.docx` (60 tables, all fifteen Y phases).
The original sources and their generator are retained in those folders.

All 188 native `Rows.HorizontalPosition` and `VerticalPosition` getters are
one twip earlier than the XML values. The reference application's read-only `WordOpenXML` snapshot
retains every original `tblpX` and `tblpY`. All exact row heights are unchanged.
This distinguishes the getter result from document coordinates and rejects
using that getter alone to shift logical layout. No visual equivalence or native
pixel algorithm is inferred from these metadata observations.

Owned source copies remained saved and empty, were closed without saving,
and match the original bytes after closure. `capture_border_positions.ps1`
invokes the reference-opening helper, reads metadata, extracts only coordinates
from the in-memory XML and closes only the exact unchanged owned source.
It never retains the in-memory package, font programs or other app state.

`record_border_position_getters.py CAPTURE_DIRECTORY` reproduces these three
JSON files from `axis-metadata.json`, `dense-metadata.json` and owned sources
named `border-{axis,dense}-position-owned-20261002.docx`. The reference binds
original DOCX, cases and unmodified native metadata by SHA-256.
