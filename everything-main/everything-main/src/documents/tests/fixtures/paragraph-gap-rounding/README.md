# Paragraph gaps and empty paragraphs

Original five-part OOXML authored by `tools/paragraph_gap_rounding_fixture.py`.
No corpus text, images or font programs are included. Compatibility mode 15,
Letter pages and 72pt margins are explicit. Arial, Trebuchet MS and Times New
Roman at 11pt use automatic spacing 259/240. Ten after values (0, .25, .5, .75,
1, 1.25, 2, 4, 8 and 30pt), each with text and empty variants, produce 60 pages
and 840 paragraphs. Every page has 14 paragraphs; the empty variant retains
only the first and last labels. The last paragraph has zero after spacing.
All run and paragraph-mark formatting is explicit. There are 480 visible
native origins and 30 pairs of corresponding first/last origins.

The reference application captured these pages from an unchanged, owned read-only scratch
copy. `page-capture.json` binds every EMF and the source hash; `source-close.json`
records the separate helper-opened source's unchanged close without saving.
The capture instance's own document/process were also closed. Existing reference
documents were preserved. These vectors contain drawing/text records, not font
programs. The bounded verifier rejects unexpected transform/record inventories
and checks logical mapping, labels, font descriptors, advances, hashes and
page geometry. It does not claim a physical glyph-raster oracle.

The browser regression measures actual CanvasEditor layout and checks every
absolute baseline and first-to-last interval within .2pt of the reference application. Text/empty
pairs must match exactly in both the native reference and the viewer. The measured maxima are
.181531pt absolute and .173017pt interval error. These are regression bounds,
not a claim of perfect rendering or a normative OOXML tolerance.

First-origin phase changes by .12pt in some native cases. Subtracting two
first-to-last spans therefore does not isolate exact paragraph-gap allocation.
The controls reject both a positive-gap minimum equal to the full extra auto
leading and uniform rounding of every gap to .12pt. They establish no general
layout correction or reference/spec divergence. Mixed sizes and picture transitions
in the poetry booklet remain unresolved; its corpus verdict is still partial.

Relevant clauses: ECMA-376 Part 1 §17.3.1.33 (`spacing`), §17.3.1.23
(`pageBreakBefore`), §17.3.2.26 (`rFonts`) and §17.3.2.38 (`sz`). The spacing
clause specifies inter-paragraph maximum and absolute after units; it does not
specify the reference application's native drawing-coordinate quantization.

Regenerate into a scratch directory with:

```
python tools/paragraph_gap_rounding_fixture.py --destination <scratch-directory>
python tools/record_paragraph_gap_pages.py tests/fixtures/paragraph-gap-rounding --verify
npx playwright test tests/browser/paragraph-gap-rounding.spec.js --config tools/border-relative-browser.config.mjs --workers 1
```

Before replacing native evidence, confirm an owned exact scratch copy using
the reference-application helper, then capture with `tools/capture_docx_page_metafiles.ps1`:
ExpectedPages 60, ExpectedParagraphs 840, WidthPt 612, HeightPt 792 and the
regenerated source SHA-256. Review source/capture provenance before recording.
