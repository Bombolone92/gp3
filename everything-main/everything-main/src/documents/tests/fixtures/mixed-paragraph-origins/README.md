# Mixed-size paragraph origins

Original five-part OOXML authored by `tools/mixed_paragraph_origins_fixture.py`.
The OPC/settings/page shell comes from the original paragraph-gap generator.
No corpus content, artwork or font programs are included. Compatibility mode 15,
Letter pages and 72pt margins are explicit. Three families (Arial, Trebuchet MS,
Times New Roman), paragraph-mark sizes 11/12/28pt, after spacing 0/30pt and zero
or five preceding 11pt paragraphs produce 36 pages and 198 paragraphs. Each
heading has 28pt TITLE and a manual break followed by 12pt BY and 11pt AUTHOR.
Two 11pt body lines and an AFTER paragraph follow. Prefix paragraphs have 8pt
after spacing, as does the body paragraph; all line values are 259/240 auto.
There are 234 native visible origins, including separate BY and AUTHOR records.

The reference application captured an unchanged, owned read-only scratch copy after exact
path confirmation by the reference-opening helper. `page-capture.json` binds every native
page vector and the source. The capture instance/document were closed, and the
separate helper-opened document was closed only after exact path, Saved and
authored text checks. `source-close.json` records its unchanged post-close hash.
The initial close-helper invocation failed to load ZipArchiveMode, before any
document binding or close; loading System.IO.Compression resolved it. No other
reference application document or process was closed.

The bounded verifier checks source/cases/capture hashes, page geometry, logical
mapping, labels, declared font descriptors and advances. Native vectors contain
no font programs. The browser measures actual CanvasEditor fragments; all 234
baselines remain within .2pt of the native reference, with maximum .165540pt.
This tests mixed-size layout against measured origins, not pixel equivalence.
No production formula is changed and no normative reference/spec conflict is proven.

Relevant ECMA-376 Part 1 clauses: §17.3.1.33 (`spacing`), §17.3.3.1 (`br`),
§17.3.1.23 (`pageBreakBefore`), §17.3.2.26 (`rFonts`) and §17.3.2.38 (`sz`).
Pictures, scripts, other compatibility modes and more general shaping remain
separate investigations.

Regenerate with `python tools/mixed_paragraph_origins_fixture.py --destination
<scratch-directory>`. After confirming an owned scratch copy with the reference-opening
helper, capture with `tools/capture_docx_page_metafiles.ps1`: ExpectedPages 36,
ExpectedParagraphs 198, WidthPt 612, HeightPt 792 and the regenerated source hash.
Verify with `python tools/record_mixed_paragraph_pages.py <capture-root> --verify`.
The browser test uses the already running Vite instance:

```
npx playwright test tests/browser/mixed-paragraph-origins.spec.js --config tools/border-relative-browser.config.mjs --workers 1
```
