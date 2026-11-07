# Mixed-size manual-break paragraphs after empty chains

`tools/mixed_font_chain_fixture.py` independently authors these OOXML controls
using the original automatic-line-spacing fixture only as an OPC/styles/settings
shell. No corpus text, artwork, font programs or viewer measurements are used.
The fixture, reference data and derived native captures use the repository's
MIT license. Native EMFs retain font descriptors, not font programs.

There are 72 pages, 768 paragraphs, 1056 layout lines and 720 visible labels.
Four installed fonts (Arial, Trebuchet MS, Times New Roman and Garamond) are
paired with automatic spacing values 240/259/276 and 0/5/12 empty paragraphs.
Paragraphs have 8 pt after-spacing. The mixed paragraph has 30 pt after-spacing,
28 pt text before a manual break, then adjacent 12 pt and 11 pt runs. Its mark
declares 12 pt in either the text's family or a different installed family.
Three two-line body paragraphs follow. Compatibility mode 15 is explicit.

The reference application opened an exact scratch copy through the reference-opening helper.
`tools/capture_open_docx_page_metafiles.ps1` observed all Page.EnhMetaFileBits
without saving or changing the UI. The source hash and Saved state remained
unchanged. The helper-opened copy was writable; `readOnly` is correctly false.
The recorder checks source/case/capture hashes, page sizes, all labels and face
descriptors, bounded identity GDI mapping and baseline alignment. This is not
a glyph-raster reference or a generic EMF mapping claim.

Regenerate with `python tools/mixed_font_chain_fixture.py DESTINATION`.
After helper-opening an owned scratch copy, use the exact-open capture tool with
its full path, a fresh output directory, source SHA-256, 72 pages, 768 paragraphs,
612 pt width and 792 pt height. Verify the retained native reference with:

```
python tools/record_mixed_font_chain.py tests/fixtures/mixed-font-chain/native --output reference.json
```

All 36 pairs have exactly equal native baselines despite the different mark
font. The browser regression verifies this equality and preserves .2 pt
absolute/relative baseline bounds. These measured bounds do not certify perfect
fidelity to the native reference. Floating drawing anchors, table/story text, script positioning,
glyph rasterization, PDF export and book-fold pages are outside this control.
