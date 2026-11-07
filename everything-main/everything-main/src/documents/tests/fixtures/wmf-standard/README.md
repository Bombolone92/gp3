# Standard WMF and native compatibility controls

`tools/wmf_standard_fixture.py` builds eight independent variants from our own
record-authored `wmf-vectors` and `emf-paths` controls. No corpus media is copied.
In row-major order, the cases are:

1. Placeable WMF baseline.
2. Standard WMF without the optional placeable header.
3. Standard WMF with translated origin and reversed vertical window extent.
4. Standard WMF with an odd-length private comment and padding.
5. Placeable WMF with COLORREF high byte 0x02.
6. Standard WMF with comment and flagged colors, named `.emf` and declared EMF.
7. Standard WMF with flagged colors and the correct WMF name/declaration.
8. An actual EMF ellipse named `.wmf` and declared WMF.

The reference application rendered all eight cases on one page. The native full
page was visually inspected. `tools/export-reference.ps1` verifies FullName
and exports `native.pdf`; `tools/record_wmf_vectors.py --folder wmf-standard`
records 15,531 stable interior samples and binds source/PDF hashes. Browser
tests compare every sample before and after editing and after export/reopen,
check media/package preservation and exact undo. Unit tests cover header and
viewport validation, all truncated prefixes, malformed comments, embedded-EMF
rejection, missing window extents, and original placeable playback regressions.

MS-WMF §3.1.3 assigns viewport setup to the embedding player; standard WMF has
no placeable frame or physical resolution. The importer therefore retains the
DrawingML picture viewport in session asset metadata. It does not modify media
bytes, relationships or content-type declarations.

Native compatibility exceptions are deliberate: §2.2.2.8 requires a zero COLORREF
reserved byte, but the native controls accept PALETTERGB (0x02) with ordinary
RGB output on the true-color target. Palette-index colors and custom palettes
remain unsupported. §2.3.6.25 describes escape 0x000F as an embedded EMF record;
The reference application also accepts private comment data. Known WMFC embedded-stream signatures
remain rejected rather than silently discarding alternative artwork. The reference application also
accepts both WMF/EMF name/declaration swaps above. These rules are format-based,
not specific to any template.
