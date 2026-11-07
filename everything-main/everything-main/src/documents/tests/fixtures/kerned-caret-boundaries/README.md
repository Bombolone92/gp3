# Kerned caret boundary controls

The independently authored four-paragraph control is the unchanged Source Sans
Pro/Arial, kerning off/on, ligatures-none source from
`tools/gpos_only_kerning_fixture.py`. Its source and authored text use the
repository MIT license. No corpus content or font program is included.

The reference application opened a hash-identical owned scratch copy with the reference-opening helper.
Detached collapsed `Range.Information(5/6)` calls recorded 120 insertion-point
coordinates without selecting, editing or saving the document. `native-page.emf`
records that same fresh native page's actual text/face descriptors. Source hash,
page hash, saved state, zoom and capture method are retained in `native-carets.json`.
Only this owned scratch document was closed without saving.

These are screen-coordinate caret observations. At the captured zoom, the reference application's
coordinates have approximately 0.75pt device granularity; they are not exact
PDF glyph origins. The native GDI capture independently shows caret and glyph
coordinates can differ. Browser tests require every caret within 0.4pt, check
pointer hits and selection edges, and preserve source parts through editing,
undo and reopening. The earlier enabled-mode Arial PDF glyph discrepancy in
the GPOS suite remains unchanged and is not excused by this caret bound.

Before correction, the Source Sans and Arial kerned rows differ from native
carets by up to 1.865925pt and 1.681641pt. After applying the following pair's
adjustment to the preceding boundary, they differ by at most 0.366085pt and
0.363281pt. Kerning-off rows remain at 0.353989pt and 0.307617pt. All four actual
text paints separately reconstruct at suffix candidate origins with zero alpha
pixel differences. This is bounded horizontal ASCII/pair-kerning evidence,
not universal contextual-shaping or complete document equivalence.

To reproduce, generate the Source Sans control with the existing Python fixture
builder, copy its `source-sans-kern-True-none.docx` to scratch and open that copy
with the reference-opening helper. At a zoom where all four paragraphs are on screen, run:

```powershell
powershell.exe -NoProfile -File tools/record_kerned_caret_boundaries.ps1 -Source ABSOLUTE_SCRATCH_COPY -OutputRoot ABSOLUTE_SCRATCH_OUTPUT -CloseOwnedDocument
```

The recorder only accepts the hash-bound authored control, rejects invisible
caret coordinates, checks saved state and source preservation, and never changes
selection or zoom. `-CloseOwnedDocument` closes only the explicitly supplied copy.
