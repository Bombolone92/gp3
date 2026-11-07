# Larger native cubic coverage controls

Six authored counterexamples selected from the numerical flattening sweep:
seeded-3, 7, 11, 27, 5 and 14. Inputs are quantized to 1/16 unit, translated by
integer offsets into separate columns, and closed with straight segments. No
corpus artwork is included. `tools/svg_cubic_coverage_fixture.py --large` creates
the DOCX and case manifest. Intrinsic SVG dimensions are 6600×1100; displayed
picture dimensions remain those of the standard SVG fixture.

The reference application captured the first inline instance read-only. The original EMF,
nested SVG EMF and six extracted mask PNGs are retained with hashes. All six
native GDI+ half-offset path captures match the reference application's alpha exactly. The tolerance-0.25
native flattened polygons also match every native alpha pixel with half-open,
nonzero-winding 8×4 sampling. This validates the selected larger cases through
the native reference; it does not validate every case in the 113-curve API-only sweep.

The two portable candidates remain unreleased:

| Case | Midpoint subdivision: changed pixels / maximum error | Finite differences: changed pixels / maximum error |
| --- | --- | --- |
| seeded-3 | 122 / 32 | 7 / 24 |
| seeded-7 | 1,287 / 40 | 0 / 0 |
| seeded-11 | 483 / 64 | 0 / 0 |
| seeded-27 | 2,091 / 255 | 51 / 40 |
| seeded-5 | 0 / 0 | 0 / 0 |
| seeded-14 | 2 / 8 | 2 / 8 |

Reproduction follows the smaller `svg-cubic-coverage` fixture, using width 6600
and height 1100 for `tools/diagnose-svg-cubic-path.ps1`. Record the results with
`tools/record_svg_cubic_coverage.py <captures> <fixture> --compressed-alpha`.
The decoded reference alpha is zlib-compressed in the JSON to avoid duplicating
large uncompressed rasters. `tools/probe_svg_cubic_coverage.py <output.json>`
reproduces the comparison above; its expected exit status is 1 while candidate
differences remain.

Validation: seven larger-control tests plus seven existing smaller-control tests
pass. The browser opens one editable page without runtime errors. No-edit ZIP
preservation, insertion, unrelated parts, exact undo and edited reopening pass;
the source and three exports pass all 40 XML schema checks. These workflow checks
do not claim current browser raster fidelity. No production behavior changed.
