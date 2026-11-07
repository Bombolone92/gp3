# Exact semibold font face

`tools/semibold_face_fixture.py` authors the OOXML directly, independently of
the viewer's importer/exporter. Four 14-point runs request Source Sans Pro
SemiBold with regular, italic, bold and bold-italic formatting. Each ends in
an independently authored black inline advance marker.

The reference application opened a byte-identical owned copy. Repeated read-only visible
marker observations preserved the source and Saved state. A fresh native PDF
provided precise marker origins; the screen observations round to pixels and
remain separately recorded. `tools/record_semibold_pdf.py` reads only PDF
placement operators, never embedded font programs. The native PDF remains a
local review artifact; its SHA-256 is recorded in `reference.json`.

The upright 2.045 and italic 1.075 unmodified Adobe releases match all four
native marker origins within 0.1 point. Intrinsic CSS weight 600 preserves
semibold advances when the DOCX also requests bold. Existing generic legacy
GPOS handling applies; no document-specific spacing is added. Font provenance
and retained OFL notices are in `public/fonts/PROVENANCE.md`.

The browser control forces only the exact local semibold face absent. It checks
atomic regular/italic asset registration, native positions, no-edit and undo
package identity, edited unrelated parts, reopening, and a failed italic asset.
