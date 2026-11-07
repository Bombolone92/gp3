# Native rotated-text diagnostics

Captured from the existing original `../control.docx` using the reference application.
The document contains independent Arial tables, not corpus artwork. The manifest
binds that DOCX, the table-one EMF, the extracted text records and the range API
positions. No font binaries are included.

The three `Alpha beta` runs have identical logical glyph advances at 0, 90 and
270 degrees. This rules out a rotation-dependent advance correction for this
control. Logical EMF coordinates are deliberately not converted to page points:
the inspector does not resolve transforms, clipping or physical page placement.
It is a diagnostic for Unicode GDI records, not a general EMF renderer.

The range API advances along the expected axis in all three directions, but
all captured coordinates lie on a 0.75pt grid. They cannot resolve the remaining
0.214pt discrepancy in original #338. Its placeholder labels also produce mostly
constant range positions; that does not establish a general rotated-text API
failure. The automation API documentation describes these values as selection/range positions, with -1
when unavailable, not precise painted glyph origins:
[WdInformation](https://learn.microsoft.com/en-us/dotnet/api/microsoft.office.interop.word.wdinformation?view=word-pia).

Fresh #338 PDF/browser comparisons retain 15 pages and a maximum 0.213862pt
reading-axis difference. Its table metafile has stable advances across repeated
labels, but bottom-label placement differs from the full-document PDF. Therefore
table extraction is not a substitute for the original full-page reference.
The source and its artwork remain private. No new renderer behavior or corpus
completion is asserted.

This closes the range-API/metafile route as a way to justify a subpixel offset.
Any further correction needs an independent control that explains full-page
placement across translations and both rotation directions. Do not tune font
widths or add a constant offset to match this single source's PDF coordinates.
The earlier `../reading-axis` native comparison remains the rendering regression.

Reproduce from the repository root (the reference application required for capture):

```powershell
powershell -NoProfile -File tools/capture-table-metafile.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/control.docx" -OutputPath "$PWD/tests/fixtures/cell-text-direction/native-text/table1.emf" -TableIndex 1
powershell -NoProfile -File tools/record-native-range-positions.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/control.docx" -OutputJson "$PWD/tests/fixtures/cell-text-direction/native-text/range-positions.json" -TextPattern '^Alpha beta$'
python tools/inspect_emf_text_records.py tests/fixtures/cell-text-direction/native-text/table1.emf tests/fixtures/cell-text-direction/native-text/metafile-text.json
python tests/native_rotated_text_test.py
npx playwright test tests/browser/cell-text-direction-reading-axis.spec.js
```

Recapture may change bytes or coordinates with reference/device configuration; review
the results before refreshing manifest hashes. The Python checks verify source
binding, extraction, rotation invariance and coarse API coordinates. They do not
test or certify the document renderer.
