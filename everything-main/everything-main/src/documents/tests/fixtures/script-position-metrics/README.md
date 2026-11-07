# Script baseline metric controls

These manually authored WordprocessingML controls isolate the remaining
vertical-script positioning discrepancy in corpus document #252. They are
diagnostics, not a new renderer rule or a completed corpus comparison.

`tools/script_position_metrics_fixture.py` creates a three-part OPC package
with 14 pages and 56 rows: 12pt and 20pt, superscript and subscript, in each
font. Each row has ordinary START/END runs around the scripted TEST run.
It uses `w:vertAlign` (ECMA-376 Part 1 §17.3.2.42); the standard describes the
alignment but does not prescribe the reference application's font-metric selection and rounding.

The fonts derive from the repository's `public/fonts/BebasNeue-Regular.ttf`,
under the accompanying SIL Open Font License. All derived family and
PostScript names use SPos; no derived font is loaded by the application.
Glyphs, advances, hinting and all other font tables remain unchanged except
names, checksum adjustment, removal of DSIG and the declared metric fields.
The generator is the corresponding source for every derived font binary.

Two groups set the OS/2 superscript offset to 700 or 0 units, exercising the
existing sizing rule's metric/fallback branches. Both set the subscript
offset to 250. Within each group, six variants independently change Windows,
typographic or horizontal-header ascender/descent metrics; a base variant
retains those original metrics. No sizes or offsets come from viewer output.

Run locally from the repository:

```text
python tools/script_position_metrics_reference.py --verify-source-only
python tools/check-docx-schema.py tests/fixtures/script-position-metrics/controls.docx
powershell -NoProfile -File tools/export_script_position_metrics.ps1
python tools/script_position_metrics_reference.py
```

The source verifier checks all 56 XML rows, font inventory, whole-font
checksums and byte equality of unchanged font tables. The native extractor
additionally requires 14 PDF pages, exact face identities, all 168 text runs
and untransformed text matrices before recording positions and hashes.
The exporter temporarily registers only these derived OFL fonts, opens the
source read-only, and removes the registrations when its COM operation ends.

Source integrity and ECMA schema validation passed on September 29, 2026.
The original PDF export is still running. A separate read-only native capture
completed all fourteen `Range.EnhMetaFileBits` groups; those native EMFs and
`emf-reference.json` now provide 56 measured positions without waiting for PDF.
Reproduce the capture and extraction locally:

```text
powershell -NoProfile -File tools/capture_script_position_metafiles.ps1
python tools/record_script_position_metafiles.py --verify-gdi
```

The bounded extractor verifies baseline alignment, contiguous run advances,
the 600-unit/inch mapping, untransformed text, and the EMF+ GetDC interval.
It rejects unsupported records instead of ignoring possible drawing or
mapping changes. The optional Windows check reselects each captured LOGFONT
using process-private OFL fonts and compares every selected font table with
the input. This verifies resolution at extraction time, not a retrospective
dump of the font bytes selected inside the reference application. No Aptos label font bytes are
read or distributed.

Windows and horizontal-header metric changes affect native script placement;
typographic ascender/descent changes do not affect these controls.
A prior ascent/descent-gap hypothesis matched only 65 of 108 existing native
script cases and is not accepted as a rendering rule. Document #252 remains
partial and production script-position calculations remain unchanged.
