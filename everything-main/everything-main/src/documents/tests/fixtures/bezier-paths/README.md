# DrawingML curve reference

Original OPC/XML generated with the Python standard library by
`tools/canvas_bezier_fixture.py`. No corpus artwork or third-party engine is
included. Both exact sources were opened in the reference application and
exported to the adjacent `native.pdf` without saving the DOCX.

`bezier-paths.docx` covers cubic and quadratic curves, filled and open stroked
paths, actual ink beyond the frame, degenerate curves, guide coordinates and
anisotropic nested group scaling. `bezier-close-paths.docx` isolates six command
sequences after close. The reference application suppresses five complete paths; only the variant
that starts a new subpath with moveTo remains visible. This differs from the
ignore-subsequent-lines/curves wording of ECMA-376 Part 1 §20.1.9.6.

Run `tools/bezier_reference.py` with the fixture stem (default
`bezier-paths`) to extract eight cross-sections for each shape at 288 dpi.
Source SHA-256 accompanies each reference. Samples include outside-frame ink
and empty areas, and avoid tangent/horizontal boundary rows where antialiasing
makes horizontal extent unstable. Browser tests compare intervals within
0.75pt, repeat after editing/undo/reopen and check every ZIP entry after undo.
These are geometry checks, not pixel-identical font or raster comparisons.
