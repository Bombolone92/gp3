# Multi-page inside/outside parity holdout

`control.docx` contains four independently labeled, 18-row floating tables,
separated by next-page sections and parity spacer pages. Its XML is manually
authored by `tools/aligned_floating_parity_holdout.py`, using only our owned
six-part scaffold. It includes Arial declarations, no font programs or artwork,
and no corpus document content. Regenerate into a fresh directory with
`--output-directory PATH`; DOCX and manifest must reproduce byte for byte.
Do not overwrite the source while the reference application has it open.

The manifest froze eleven-page predictions before native capture: inside on
odd/even zero-based first pages 1/4, outside on even/odd first pages 6/9.
The reference application confirmed all 72 row identities and those page ranges. Each
table keeps its first fragment's horizontal side on its continuation page.
The source SHA is `542ee5c1919c6248d14b0a5c50149d08ba62e7509b39438de7b094b4a8b3d3b1`.

`reference.json` contains native declared Unicode text origins only.
Guarded capture preserved the exact opened source, Saved state, selection,
view and zoom. The metadata reader removes FontFile references before font
construction and rejects glyph-program fallbacks. Native PDF and EMF files
remain private; no native glyph or raster certification is claimed.

Production now supports these horizontal multi-page alignments. The unit
regression checks every row, page range, source model preservation and exact
package export. The historical route diagnostic requires a guarded baseline
engine directory; `tools/verify-aligned-floating.mjs` checks the actual runtime.
Initial page numbering and leading flow are covered by the separate edge
controls. The earlier first-page report remains historical evidence.
