# Single table-border phase controls

`tools/border_phase_fixture.py` authors sixteen independent one-cell floating
tables directly as deterministic OPC/XML. Columns vary the numeric page
position by 0, 4, 8 and 12 twips. Rows vary single-border size by 2, 4, 8 and 18
eighth-points. Every table is 48pt wide with an exact 24pt row, zero cell margins,
black borders and an empty one-point paragraph. The page is 288pt by 216pt in
compatibility mode 15. No corpus content is used.

The reference application opened an exact private copy. Native screen observations at 100%
and 200% use page origins (439,310) and (247,212), respectively, on the 1280x752
desktop. The two committed PNG crops preserve the original JPEG artifacts;
neutral black frame bounds use the fixed threshold 128, not a color/opacity
comparison. All sixteen complete frames are visible at each zoom, and their
measurement regions avoid the caret, pointer and table handles.

The reference application's Save As PDF export also supplies sixteen groups of twelve filled border
rectangles, with a 288x216pt media box. The PDF stays in private work storage;
the reference records its hash and numeric rectangles. The recorder checks
that the reference application's opened DOCX is byte-identical to the independently authored source.
Source, cases and capture/crop hashes are in `reference.json`.

At baseline `f7ee393a`, 10 of 16 screen frames differ at 100%, and 12 of 16
differ at 200%. The largest individual edge difference is two device pixels.
The native PDF and engine logical frame bounds also differ by up to 0.19pt.
These findings do not justify shifting every border or changing only the
rounding call: physical table placement and display quantization must be
separated, with junction connectivity, clips, row heights and shading preserved.
The prior width and connected-frame controls remain required regressions.

Two unit checks bind evidence and preserve all sixteen tables/package parts.
The source passes three schema views and loads as one editable page at both
zooms. Two browser tests explicitly mark only the final native-frame comparison
as expected failure; loading and extraction must succeed first. Remove these
markers when the general placement rule matches every frame. They are evidence
of an unresolved defect, not passing fidelity checks.

Relevant specification family: ECMA-376 Part 1 §17.4, including §17.4.57
(`tblpPr`). The source declarations remain unchanged. No definitive reference/spec
divergence or new production rule is claimed yet.

Reproduce with Vite at 0.0.0.0:5173:

```
python tools/border_phase_fixture.py
node tools/diagnose-border-phase.mjs <work>/border-phase-baseline
python tools/record_border_phase.py <work>
```

The recorder expects the private `border-phase-native.docx`, two
`border-phase-native-{100,200}.jpg` captures and `border-phase-native.pdf`, all
obtained through the documented reference-opening helper and the reference application's own UI.

## Intermediate positions and document order (2026-09-30)

`--name holdout` uses 2, 6, 10 and 14 twips instead of the original phases.
`--name reordered` reverses the sixteen table/anchor-paragraph pairs in the
original XML while leaving every absolute position and table property unchanged.
The case files stay in spatial order. Both are independently authored XML;
neither is a viewer export. Their private reference-opened copies are byte-identical.
The four additional native crops use the same page origins and thresholds.

Reversing source order changes **none of the 32 native frame bounds**. This
rules out source-order dependence for these controls; it does not prove that
all floating tables are order independent. The holdout changes thirteen native
frames relative to the original and has fourteen viewer/native mismatches.
The reordered control retains the original twenty-two mismatches. All sources
load as one editable page at both zooms.

Candidate rounding rules already have counterexamples, even considering only
the top edge. Let `y = yTwips / 15` be CSS pixels, `s` be zoom, and `round` mean
`floor(value + 0.5)` for these positive coordinates:

| Candidate top edge | Counterexample | Predicted / native |
| --- | --- | --- |
| `floor(y*s + .25)` | holdout case 3, 100% | 24 / 25 |
| `round(floor(y/.32)*.32*s)` | holdout case 4, 200% | 49 / 50 |
| `round(floor(y*s/.32)*.32)` | original case 4, 200% | 50 / 49 |

The `.32` grid is an experimental 300dpi hypothesis, not a specified OOXML
rule or an established reference algorithm. Use a small epsilon only when evaluating
exact grid boundaries in floating point. None of these candidates is suitable
for production. Bottom edges and row-height quantization remain unresolved as
well. The next investigation should distinguish authored positions, physical
border geometry and zoom-dependent edge placement, using additional origins
and zooms rather than fitting offsets to one corpus document.

Reproduce the additional observations after capturing each named private copy
in the reference application at 100% and 200%:

```
python tools/border_phase_fixture.py --name holdout
python tools/border_phase_fixture.py --name reordered
node tools/diagnose-border-phase.mjs <work>/border-phase-holdout-baseline tests/fixtures/border-phase/holdout.docx
node tools/diagnose-border-phase.mjs <work>/border-phase-reordered-baseline tests/fixtures/border-phase/reordered.docx
python tools/record_border_phase_variants.py <work>
```

The recorder requires `border-phase-{holdout,reordered}-native.docx` and
`border-phase-{holdout,reordered}-native-{100,200}.jpg` in private work storage.
It records source/cases/capture/crop hashes and measured bounds in the separate
variant reference files. It does not alter the original reference or extract
any native fonts. Four unit checks cover evidence binding, source order and
package preservation. Six browser checks retain expected failures solely at
the final native comparison. Both new sources pass all three applicable XML
schema checks. This is additional defect evidence, not a renderer fix or a
completed corpus document; corpus counts remain 368 inspected, 209 complete,
159 partial.

## Native coordinate getters (2026-09-30)

`native-coordinate-reference.json` retains observations of the original and
holdout sources in the reference application at 75, 100, 125, 150 and 200 percent zoom.
`tools/record-border-native-coordinates.ps1` opens its own hidden, read-only reference application
instance, confirms the source and its hash, and closes only that instance.
Optional Save As copies remain private; their hashes and extracted positions
are recorded. All 32 serialized table positions remain unchanged after Save As.

For these controls, the table-position COM getters report one twip less than
the authored value. Collapsed cell range coordinates are identical at all five
zooms. Neither observation establishes physical border coordinates: the native
screen evidence already varies with zoom. Do not shift the engine by one twip
or round layout to the range getter's grid. The evidence-binding unit check
records these limitations without changing the expected screen failures.
The border discrepancy remains unresolved; no corpus document is promoted.

## Intermediate zoom painting (2026-09-30)

The original source was additionally captured at 125% and 150%. The settled
native page origins were (391,274) and (343,238); all sixteen frames fit inside
each capture. `native-intermediate-reference.json` binds the source, cases,
original reference, native JPEGs and the two PNG crops. The fixed threshold
remains 128. Captures were refreshed after the reference application completed zoom repainting.
The viewer's four-zoom diagnostic loads one editable page without errors;
its 100%/200% PNGs are byte-identical to the earlier baseline.

Fourteen frames differ at 125% and six at 150%. Simple centre-based alternatives
also fail. Given authored leading coordinate `p` in scaled CSS pixels, scaled
width `w`, and device thickness `d=max(1,floor(w+1e-6))`, apply floor, nearest
positive rounding or ceiling to `p+w/2-d/2+1e-6`. Across 128 leading edges at
four zooms, they have respectively 32, 46 and 104 counterexamples. These formulas
are rejected diagnostic hypotheses, not OOXML rules or reference algorithms.

The two new browser cases retain expected failures only at native frame
comparison, after editable loading and finite extraction succeed. Six unit
checks bind all evidence and retain original package parts. Neither schema nor
build checks were repeated: no DOCX source or production code changed.
Page origins vary with zoom; independent origin changes at one zoom remain
untested. Physical placement and rasterization still need to be separated.

```
node tools/diagnose-border-phase.mjs <work>/border-phase-intermediate-baseline tests/fixtures/border-phase/control.docx 1,1.25,1.5,2
python tools/record_border_intermediate.py <work>
```

The recorder requires the unchanged private `border-phase-native.docx`,
settled `border-phase-native-{125,150}.jpg` captures and prior
`border-phase-baseline/app-{100,200}.png` controls. Native PDF remains private.

## Filled and borderless cell isolation (2026-09-30)

`filled.docx` adds only red cell shading to the original control.
`borderless.docx` additionally replaces every border with `nil`, retaining all
authored positions, widths, exact row heights, zero margins and paragraphs.
Both are manually authored OPC/XML and pass six applicable schema views.
The reference application exports one page each; the viewer also loads one editable page
without errors at 100%, 125%, 150% and 200%. Neither uses corpus content.

`native-fill-reference.json` binds native PDFs, numeric fill rectangles and four
settled reference screen crops at 100%/150%. The filled control's 192 black PDF
rectangles are exactly unchanged from the original control; borderless has
none. PDF measurements still show small placement differences without border
ink. This does not prove a reference/spec divergence: exact device quantization is
not specified by the table declaration family, ECMA-376 Part 1 §17.4.

JPEG chroma subsampling distorts saturated-red edge colours. A strict RGB
threshold falsely inflated the mismatch counts and was rejected. The recorded
measurement uses the red/white luminance midpoint (<166 with .299/.587/.114
weights), R>128 and red dominance >32, also excluding black borders and white
handles. These are threshold bounds, not exact colours or complete-page equivalence.
Borderless matches all sixteen bounds at 150%, but differs on four at 100%.
Filled has four discrepancies at 150% and ten at 100%.

A further **unshipped** hypothesis uses `q(v)=floor((v-1e-7)/.16)*.16` and
positive nearest rounding `r(v)=floor(v+.5+1e-7)`, in CSS pixels. For authored
origin `(x,y)`, table width `W`, exact row height `H`, border width `w` and zoom
`s`, let `d=floor(w*s+1e-7)`. Predicted outer bounds are
`[r(q(x)*s)+min(0,d-1), r(q(y)*s), r(q(x+W)*s)+d, r(q(y+H+w)*s)]`.
Across 128 previously captured frames, it matches all left, top and right
edges, but fails fifteen bottoms. The evidence retains every counterexample.
This was developed from these observations; it is not independent proof of
the reference application's algorithm. Other widths, row heights, origins, zooms and table contexts
are needed before proposing a production rule. Bottom row geometry remains open.

Nine local unit checks cover evidence and package preservation. Four browser
checks cover actual editable loading and the stated extraction: borderless at
150% passes the native assertion; the other three retain expected failures
only at that assertion. No production code changed, and no corpus document is promoted.

```
python tools/border_phase_fixture.py --name filled
python tools/border_phase_fixture.py --name borderless
node tools/diagnose-border-phase.mjs <work>/border-phase-filled-baseline tests/fixtures/border-phase/filled.docx 1,1.25,1.5,2
node tools/diagnose-border-phase.mjs <work>/border-phase-borderless-baseline tests/fixtures/border-phase/borderless.docx 1,1.25,1.5,2
python tools/record_border_fill.py <work>
```

The recorder expects private `border-phase-{filled,borderless}-native.pdf` and
settled `border-phase-{filled,borderless}-native-{100,150}.jpg` captures. PDFs
remain private; only original control crops, hashes and numeric geometry ship.

## Exact row-height holdouts (2026-09-30)

`heights-thin.docx` and `heights-wide.docx` independently hold border size
constant at 2/8pt and 18/8pt, respectively. Rows declare exact heights of
473, 479, 481 and 487 twips (23.65, 23.95, 24.05 and 24.35pt); columns retain
the original position phases. These are new XML controls, not viewer exports.
The unchanged 600dpi hypothesis was tested without fitting the new heights.
Each family matches all 32 left, top and right edges across 100% and 200%,
but introduces four bottom counterexamples. Both source packages pass six
schema views, and the reference application and the viewer each prepare one page. Native PDFs stay
private; numeric rectangles and four settled screen crops are bound in
`native-height-reference.json`. Pointers/glows were moved outside measured regions.

An isolated Canvas paint prototype applied 600dpi truncation before device
rounding, shifted subpixel vertical borders outward by one device pixel, and
aligned bottom ink to its trailing extent. The logical layout remained unchanged.
It reproduced the numerical model: complete frame matches increased from
68 to 169 out of 192. However, four previously correct bottom edges regressed,
including one new exact-height control. The prototype is **rejected and unshipped**;
better aggregate matches do not meet the user's no-regression requirement.
Candidate/probe/raw-observation hashes and each regression are retained. No
production import uses the private prototype; no performance or editor-wide
equivalence claim follows from the isolated painting experiment.

A separate hidden, read-only reference probe reports all authored thin-control row
heights within 0.00001pt. `GetPoint` of table ranges includes extra selection
width, while empty-cell ranges can be 1x1. Its uncaptured window origin is
unknown. The retained values are diagnostic range bounds, not ink rectangles;
do not use them for positioning. This confirms that the reference application reads these height
declarations, but does not identify its bottom-edge paint conversion.

Eleven unit checks bind evidence, inspect exact-height declarations and preserve
source package parts. Four additional browser cases must load editable pages
and extract finite bounds before their known native-comparison failures.
The thin viewer mismatches all 32 frames; wide mismatches 14/32. No runtime fix
or corpus promotion is claimed. Further work must explain bottom geometry and
cover connected borders, clipping, shading and varied table contexts before
shipping a general border rule.

The first thin/100% browser attempt timed out before pixel extraction and is
not an expected fidelity failure. An unchanged recheck reached the final known
comparison within the original 120-second timeout. Both outcomes are retained
in local test artifacts; this is not a performance-equivalence result. No production
build was repeated for these fixture/tool/evidence changes.

```
python tools/border_phase_fixture.py --name heights-thin
python tools/border_phase_fixture.py --name heights-wide
node tools/diagnose-border-phase.mjs <work>/border-phase-heights-thin-baseline tests/fixtures/border-phase/heights-thin.docx 1,2
node tools/diagnose-border-phase.mjs <work>/border-phase-heights-wide-baseline tests/fixtures/border-phase/heights-wide.docx 1,2
python tools/record_border_heights.py <work>
```

The recorder requires private `border-phase-heights-{thin,wide}-native.pdf`
and settled `border-phase-heights-{thin,wide}-native-{100,200}.jpg` captures.
It reproduces the height-control records; the separately retained range and
rejected-prototype diagnostics are not needed to measure the height controls.
