# Numbering alignment with level character spacing

These independent OOXML controls use the repository's MIT license. The generator
`tools/numbering_tracking_alignment_fixture.py` uses the existing automatic line
spacing control only as an OPC/styles/settings shell. No corpus text, artwork,
font programs or viewer measurements are included.

There are 108 labels on 12 pages: Arial, Trebuchet MS, Times New Roman and
Garamond; left/center/right level alignment; 0, +0.75 and -0.5 pt tracking;
and labels `8`, `88` and `8.`. Numbering level run properties specify tracking.
Body text uses Arial 12 pt with zero tracking. The label suffix is `nothing`.

Regenerate with `python tools/numbering_tracking_alignment_fixture.py DESTINATION`.
The reference application opened an exact scratch copy through the reference-application helper. The
read-only observation tool `tools/capture_open_docx_page_metafiles.ps1` captured
Page.EnhMetaFileBits without saving or changing the UI. The opened document was
writable (`readOnly: false`); its source hash and Saved state remained unchanged.
Capture arguments require the exact source hash, 12 pages, 108 paragraphs and
612 by 792 pt page geometry. Native EMFs contain font descriptors, not programs.

Verify retained captures with:

```
python tools/record_numbering_tracking_alignment.py tests/fixtures/numbering-tracking-alignment/native --output reference.json
```

The recorder validates source/case/capture hashes, bounded identity GDI mapping,
label/body pairing and regular 12 pt font descriptors. Browser label and body
origins differ from the reference application by at most 0.06 pt; the regression bound is 0.07 pt.
This is origin evidence, not glyph raster, general shaping or font agreement proof.
The companion paragraph-mark fixture checks inherited tracking separately.
