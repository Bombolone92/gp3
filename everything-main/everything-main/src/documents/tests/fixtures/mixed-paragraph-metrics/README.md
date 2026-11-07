# Empty paragraphs and inline-picture transitions

Original OOXML and a one-pixel RGB square are authored independently by
`tools/mixed_paragraph_metrics_fixture.py`. The original automatic-line-spacing
fixture supplies only the OPC/styles/settings shell. No corpus text, artwork,
font binaries or viewer measurements are used to generate these controls.

There are 96 independent pages: Arial, Trebuchet MS, Times New Roman and Garamond;
11/28 pt text; automatic line values 240/259/276; and four transitions (6 pt empty
paragraph, 24 pt empty paragraph, 24 pt inline picture, picture beside text).
Each page has three paragraphs and four layout lines. There are 312 visible
labels. All paragraph spacing before/after is zero and compatibility mode is 15.

The reference application was opened through the reference-opening helper on an exact scratch copy.
`tools/capture_open_docx_page_metafiles.ps1` observed the existing document's
Page.EnhMetaFileBits without changing its UI, saving, or closing it. The copy
was writable: the recorded `readOnly` is false. The source hash remained
unchanged and Saved was true before and after observation. Two independent
captures have identical label baselines; their complete EMF bytes differ.
The retained native files are the second capture made with the published tool.

`tools/record_mixed_paragraph_metrics.py` checks source/case/capture hashes,
96 page sizes, font descriptors, labels, 600 dpi header, fixed logical mapping,
balanced GDI saved DCs and text alignment. Its mapping is bounded to the
captured GDI text records. It does not interpret EMF+ picture playback as text,
certify picture raster fidelity, or provide a general EMF renderer.

Regenerate with `python tools/mixed_paragraph_metrics_fixture.py DESTINATION`.
Open an owned scratch copy with the reference-opening helper, then capture with
`tools/capture_open_docx_page_metafiles.ps1`, passing its full path, fresh output
directory, source SHA-256, 96 pages, 288 paragraphs, width 612 and height 792 pt.
Verify the retained reference with:

```
python tools/record_mixed_paragraph_metrics.py tests/fixtures/mixed-paragraph-metrics/native --output reference.json
```

The browser regression protects absolute baselines within .2 pt and relative
transitions within .1 pt. These are measured accuracy bounds, not a claim of perfect
equivalence with the native reference. They do not cover long paragraph chains, mixed font sizes
within one paragraph, floating drawings, paragraph spacing, or book-fold pages.

This original fixture, generated image, reference data and derived native
captures are distributed under the repository's MIT license. Installed font
programs are neither read nor included; only rendered font descriptors occur
in the reference.
