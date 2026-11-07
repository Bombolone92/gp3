# Unicode line-separator font fallback observations

## Normal-editor activation — 2026-09-29

The selected-font adapter is now integrated into normal font preparation,
measurement, painting and editing. This supersedes the historical withheld
integration notes below. It retains the native family as the first CSS face and
uses a supplementary U+FFFF-only face, preserving ordinary text and script fallback.
U+2028 stays unchanged in the model and DOCX. Source fonts are not distributed;
local bytes require an existing font-access grant. Unsupported or missing glyph
faces retain the existing path; effective reference fallback is still unresolved.

The production paint/layout test matches the native 9 pt Times control and its
recorded ink. Additional tests cover 24 ordinary/selected-font size/style samples,
12 production fallback samples, first insertion, late readiness, selection,
undo, source-part preservation and reopening. Fourteen unit tests also cover
atomic face publication and catalogue changes. The two corpus originals remain
partial; no corpus count is promoted by this control.


## Selected-glyph layout/paint checkpoint — 2026-09-29

`literal-separator-layout.spec.js` now tests the existing private mapping through
the actual DOCX importer and document layout. The Times New Roman sample retains
its three baseline positions (within 0.2pt of the reference application) and eight-page control, while
the separator advance changes from the browser's 2.25pt space to the reference application's 9pt glyph.
The selected glyph's native PDF raster is recorded in `separator-ink.json` by
`tools/record_separator_native_ink.py`. Candidate/native thresholded ink matches
bidirectionally within one raster pixel at four pixels per point. No reference
alignment or position fitting is applied. The preceding sample text is excluded
from the glyph crop using the native character bound.

The mapping also composes with synthetic-advance font preparation in either
order: glyph outline and advance agree. This establishes composition of those
two data transforms, not all synthetic-bold paint or kerning policies. The
layout probe substitutes only in its measurement callback; the model's U+2028
text and every exported package part remain unchanged, with no U+FFFF alias in
reopened source text.

This is an integration prerequisite, not activation in the normal editor.
Effective fallback-face selection, composition with the full derived-font
pipeline, lazy preparation after editing, caret/selection behavior and cost
remain required. The corpus scan found three U+2028 characters across two files,
all in East Asian font contexts; their missing-font/fallback issues are not
resolved by this Times New Roman control. No corpus completion is claimed.

Reproduce the additional capture and browser checks from the repository root:

```powershell
python tools/record_separator_native_ink.py
npx playwright test tests/browser/literal-separator-layout.spec.js tests/browser/literal-separator-font.spec.js
```

No production module imports or behavior changed at this checkpoint.

This is an independent, manually authored eight-page OOXML control, generated
by `tools/line_separator_fonts_fixture.py`. No corpus text or font binaries are
included. Each page has an Arial 9pt start line, a sample line, and an Arial 9pt
tail. Paragraph marks have explicit Arial 9pt properties and single spacing.
Only the sample's final character/font/size/hint varies, as listed in cases.json.

The reference application opened the exact source path and exported native.pdf.
`tools/record_line_separator_fonts.py` records the three native baselines and
page font resources, bound to the source, PDF, and case bytes by SHA-256.
Regenerating the DOCX requires a fresh native export and reference recording.

The reference application uses Arial for the ordinary-space control. With U+2028, its PDF text
operators use MS Gothic for Arial/default and Calibri/default, MS Mincho for
Arial/eastAsia and Courier New/default, and Times New Roman for that family's
case. The fallback glyph changes line metrics: at 9pt the Arial/U+2028 sample
baseline is 0.60pt below the no-separator sample, and its tail is 1.44pt below.
The 18pt separator expands the line further. This character is not a w:br.

These observations characterize this reference application installation, not a universal font
fallback order. ECMA-376 Part 1 section 17.3.2.26 defines run font declarations;
platform glyph fallback must be distinguished from those declarations. The
current browser does not reproduce all fallback choices or resulting metrics.
MS Gothic was browser-accessible here, while MS Mincho was not. No production
font substitution, whitespace suppression, metric override, or document-specific
exception is implemented. The fixture is evidence for the unresolved fallback
work; its integrity test is not an engine conformance pass.

The Times New Roman case displays a visible mark in the native PDF; the current browser does not paint that mark. This is an additional unresolved glyph-painting difference.

## Installed-glyph isolation, 2026-09-27

This case is not caused by a missing installed font. Page 6 selects `/F4`,
TimesNewRomanPSMT, and shows CID 0x102E. Its Identity CID-to-glyph map selects
glyph 4142; its ToUnicode map identifies U+2028. The installed regular Times
New Roman font also maps U+2028 to 4142. Independently parsing the embedded
subset and installed file produces identical outline hashes, 163 path commands,
2048 units per em and a 2048-unit advance. The mark is the selected font's
line-separator glyph, not an inferred replacement box.

In Edge 154.0.4258.37, direct Canvas measureText/fillText treats U+2028 exactly
like U+0020: at 12px it advances 3px and paints zero pixels; at 96px it advances
24px and paints zero pixels. Drawing the selected font's outline instead has
advances of 12px and 96px and paints 102 and 2810 pixels respectively. These
pixel counts only demonstrate that ink exists; they do not establish native
hinting or complete layout fidelity. The browser-selected local face's SHA-256
matches the inspected installed file.

Reproduce the PDF/font hashes, glyph metrics and browser observations with
`tools/inspect-separator-glyph.mjs`, passing the installed regular Times font,
the privately extracted page-6 `/F4` descendant FontDescriptor/FontFile2 bytes,
this directory's native reference PDF, an output JSON path and a running playground URL.
The diagnostic requires an authorized local-font catalogue. Neither font bytes
nor glyph outlines are committed. The extraction uses pypdf's get_data on the
FontFile2 stream; the retained PDF remains the independent native authority.

Next implementation work must distinguish browser control-character handling
from absent-glyph fallback. A generic selected-glyph paint/measurement path
needs editing, caret, style and native geometry checks before shipping. The
Arial/Calibri/MS Gothic and MS Mincho fallback-selection questions remain open;
this observation does not justify mapping all separators to Times New Roman.

The standalone `literal-separator-font.js` adapter now adds a private U+FFFF
mapping to the selected font's existing U+2028 glyph. U+FFFF is not valid XML
1.0 document text. The original mapping, outlines, hinting, advance metrics,
shaping and variation-selector tables are retained; the derived checksum is
recomputed and any source digital signature is omitted from the derived face.
The original buffer is unchanged. Missing separator glyphs, occupied aliases,
variable fonts, unsupported cmap formats and malformed buffers are declined.
This is generic font processing: no font names, glyph indices or native metric
constants are encoded in the adapter.

Original synthetic-font unit controls cover format-4 and format-12 cmaps,
all original mappings, non-cmap table preservation, source preservation and
checksum validity. A browser check exercises the locally installed Times New
Roman regular/bold/italic/bold-italic faces at 12, 48 and 96px. Ordinary text is
pixel-identical through the original and derived faces; the alias paints and
advances by the actual selected glyph width, including between two letters.
These style checks verify the adapter, not the reference application's style-dependent fallback.

The adapter is deliberately not called by document loading or painting yet.
Integration still requires effective font-slot/fallback selection, interaction
with existing derived kerning and synthetic-advance faces, caret/selection and
editing/export tests, native document geometry, and measured preparation cost.
Document text must remain U+2028; a rendering alias must never enter the model
or exported package. This work does not change corpus completion counts.

An integration candidate was exercised and then removed from the renderer.
It paints the native Times glyph, measures its 9pt advance, and brings the
following baseline to 101.1797pt (reference: 101.17999pt). The other seven control
pages are pixel-identical to baseline. Caret movement, bold formatting,
deletion, exact undo, export and reopening pass; twelve existing synthetic-bold
browser scenarios also pass. Six control/corpus exports pass 21 XML checks.
Corpus document 32 remains pixel-identical and partial because fallback selection is
still unresolved.

Activation is withheld: local preparation measurements were 668.5/788ms for
baseline versus 1612.5/1876.7ms for the candidate. Those measurements overlapped
broader verification, so an isolated performance conclusion is still pending;
they do not demonstrate acceptable preparation cost. A broader unit run was
interrupted after two canvas-kerning failures and is not claimed as passing.
Newly inserted separators, font changes and permission refresh also need
coverage. The candidate is retained privately in scratch
`<work>/literal-integration-candidate`.

The committed adapter browser test now also compares ordinary glyph paint
against the system-selected family, rather than only two buffer-loaded faces.
All twelve face/size combinations remain pixel-identical in that comparison.

## Live-edit candidate follow-up, 2026-09-27

A private candidate rebased onto 626420f8 reproduces a missing activation path:
inserting the first separator leaves its advance at 3px until an explicit font
refresh. A prototype editor hook prepares only unprepared separator families
after layout and updates the current layout when preparation finishes. The
actual inserted fragment then advances 12px, with its UTF-16 selection unchanged.
Document text remains U+2028; the rendering alias stays outside the model.

An independent live-edit probe delays each derived FontFace load by 100ms,
switches the separator from Arial to Times New Roman, types more text, and moves
the selection before preparation completes. The completed refresh retains the
latest text, selection and history length. Undo removes only the later typing;
switching back to Arial and undoing that switch restores the Times glyph width.
The prototype remains private in scratch `<work>/literal-current-candidate`.

This resolves part of the correctness investigation, not release readiness.
Three alternating baseline/candidate preparation comparisons measure main at
664.3/782.8/666.3ms and the candidate at 1878.1/1470.2/1406.9ms. An unrelated
reference export remained active, so these are local samples, not a universal latency
claim. Nevertheless, every candidate sample is substantially slower. Narrowing
initial preparation to separator-bearing font slots did not eliminate that cost.
The prototype also permits an initial approximate frame during new-glyph loading.
Renderer activation remains withheld. Missing-glyph fallback and remaining
regression/permission-refresh coverage are unresolved; corpus counts do not change.
