# Original row-geometry probes

These generators author OPC/XML with Python's standard library. They do not
import the document engine or a third-party document implementation. Run
`python tools/canvas_row_geometry_fixtures.py` from the repository to regenerate
the twenty-six fixtures under `public/fixtures/row-geometry`.

The reference data under `tests/fixtures/row-geometry` was measured from native
reference PDF exports. `provenance.json` identifies each source by canonical XML-part
hashes, excluding ZIP timestamps and XML declaration differences. All rebuilt
fixtures were compared with the actual native reference probes and passed transitional XSD
validation. Neither check alone proves layout fidelity.

To reproduce the measurements, open each fixture in the reference application, wait for pagination,
and export it as PDF without editing. Replace `-probe.docx` with `-native.pdf` in
each output filename. Keep the provided compatibility settings: absent settings
and explicit modes 14 and 15 are intentionally different cases. Use the bundled
Noto Sans font. Then run:

```
python tools/measure_native_row_geometry.py PDF_DIRECTORY OUTPUT_DIRECTORY
```

The extractor requires pypdf for development only. The recorded JSON datasets
were reproduced exactly from the original PDFs using this extractor. It reads
text baselines, filled border rectangles, and clipping paths independently of
the renderer. Text extracted outside the PDF media box must not be treated as
visible ink; representative pages were also rendered and visually inspected.

Coverage includes row-wide top/bottom padding, physical vertical-merge
continuations, border conflict widths, compound borders, exact-row clipping,
page-edge placement, ordinary repeated headers, oversized exact and minimum
rows, compatibility-dependent header omission/resumption, and body-line
clearance on pages without repeated headers. Merged-row probes cover resuming
headers above a continuing owner, legacy clipping without growing a later row,
unused page space before a later oversized row in the same merge, and the different legacy/modern flow and editing clips of oversized exact rows. The original source documents and
their measured properties remain separate from all layout implementation code.

Limitations: these probes do not establish complete layout fidelity, all horizontal
table geometry, arbitrary vertical-merge/header combinations, editing interaction
outside the physical page, or performance across every document.
Reference application: a desktop word processor on Windows. Measurements were collected on 2026-09-17.
