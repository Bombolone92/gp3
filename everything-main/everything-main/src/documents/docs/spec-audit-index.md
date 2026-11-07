# Specification audit index and implementation priorities

Checkpoint: 2026-10-09, code baseline `8b21ba04`.
The [DOCX support backlog](docx-parity-roadmap.md) is the implementation TODO list.
The ledgers below provide declaration-level evidence for its missing/partial
features. This index consolidates the current specification skim; it does not
close A01's exhaustive schema/property audit or certify native-reference/template fidelity.

## Reviewed families

Latest native check: 3D picture front-face color transfer.
The 256-gray control rejects proposed threePt rounding corrections. Exact native
color arithmetic remains open; no painter change was accepted from these fits.
The matte picture checkpoint removes
the importer rejection using the existing shader, with native, edit/undo/resize
and reopen controls. It does not close the remaining color quantization gap.
The thin-curve offset-region rejection
shows that accurate compact cubic boundaries still rasterize unstably as thin
Canvas fills. Original meal planner #226 remains editable and partial. Paired
boundary rasterization, native pixels and performance need further evidence.
The native thin-curve controls retain
physical vector pens but show why GDI+ metafile replay is insufficient as a print
raster oracle. Print-path device-pixel rounding needs an independent native print
reference before correction.
The physical outline print correction
uses the retained native reference PDF to separate physical print widths from screen
rounding. The screen and editing controls remain intact; thin-curve raster
coverage and complete native document fidelity remain open.

| Family | Evidence and outstanding scope |
| --- | --- |
| Page and paragraph layout | [Sections](section-property-coverage.md), [paragraphs](paragraph-property-coverage.md). Nested properties, grids/line numbering, frames, geometry and native pagination remain incomplete. |
| Inline text and formatting | [Run properties](run-property-coverage.md), [run content](inline-run-content-coverage.md). Missing and partial values, contexts, ruby and embedded content remain. |
| Tables and numbering | [Tables](table-property-coverage.md), [numbering](numbering-property-coverage.md). Nested properties, structures, conditional styles, formats and numbering interactions remain. |
| Style and compatibility | [Styles](style-property-coverage.md), [compatibility](compatibility-property-coverage.md), [settings](settings-property-coverage.md). Nested attributes, consumer defaults and silent omissions remain. |
| Font and theme metadata | [Font declarations](font-declaration-metadata-coverage.md), [theme structure](theme-structure-coverage.md). Complete selection, colors, defaults and overrides remain; font programs were not audited. |
| Drawing placement and pictures | [Placement](drawing-placement-property-coverage.md), [picture payloads](picture-payload-property-coverage.md). Full positioning, wrapping, transforms, effects, locks, visibility and media contexts remain. |
| Shared drawing appearance | [Shapes/fills/outlines](shape-fill-outline-coverage.md), [text bodies](drawing-text-body-coverage.md). Nested geometry/colors/effects, normal autofit, vertical/column text and full context semantics remain. |
| Charts and diagrams | [Chart containers/types](chart-container-type-coverage.md), [diagram definitions](diagram-definition-coverage.md). Current bounded cached/chart and linear diagram subsets do not establish all types, algorithms, data evaluation or visible text. |
| Fields and navigation | [Field codes](field-code-coverage.md), [bookmarks/hyperlinks/ranges](bookmark-hyperlink-range-coverage.md). Full instructions/switches, dependencies, nested content, permissions and alternative content remain. |
| Stories and annotations | [Notes](note-property-coverage.md), [comments/revisions](comment-revision-property-coverage.md). Story structures, endnotes, note placement, rich comments and structural revision semantics remain. |
| Structured controls and math | [Content controls](content-control-property-coverage.md), [math](math-property-coverage.md). Bindings/locks/types, full wrappers, professional math layout and editing remain. |

These 23 linked family ledgers distinguish implemented subsets, rejection,
silent omission, retained metadata and unverified behavior. Their schema checks
enumerate the documented boundaries; they do not validate every grammar,
imported schema, wildcard, extension, occurrence/default or native layout choice.
Strict inventories do not establish Strict package import.

## Implementation order

1. Keep R01–R06 recovery first: isolate unsupported properties/content/objects,
   preserve supported siblings and usable structure, disclose the approximation,
   and preserve original source. Editing restrictions must not erase otherwise
   usable presentation. Add mixed-feature controls at the relevant boundary.
2. Reproduce the next corpus discrepancy in core page/paragraph/table/font/drawing
   behavior. Use the corresponding ledger to identify the generic missing
   semantics, then an independently authored DOCX to test them. Do not select
   rare new families merely because their schema rows are easy to implement.
3. Implement each selected feature's import/layout/paint/edit/export behavior and
   preserve source across unsupported interactions. Add native reference comparisons
   when layout differs or a spec/native divergence is suspected. Existing test
   names and schema passes are not proof of a new feature's fidelity.
4. Complete dependencies and semantic families rather than isolated guards:
   field refresh, notes, structured controls, rich annotations, math and dynamic
   drawing content need their contextual source/data models. Keep unsupported
   cases local and represented in the TODO list until verified.

## Narrow corpus prevalence check

A source-only scan of the `<corpus>` folder found 377 DOCX
paths: nine editor lock files, 366 packages scanned successfully, and two packages
excluded because a selected XML part exceeded the scan's 32 MiB ceiling.
This scan ceiling is not an application limit or a request to restrict valid
documents. Those two packages remain unclassified by this scan.

The selected parts were main document, header/footer, note, chart and diagram
XML. The scan read raw declarations, including potentially unused/fallback
content; it did not render, open in the reference application, evaluate fields or inspect font programs.
Counts are packages containing the named declaration, not failed templates.

| Sampled declaration | Packages among the 366 scanned |
| --- | --- |
| WML ruby | 0 |
| WML alternative-format chunk | 0 |
| WML endnote reference | 0 |
| WPS normal autofit with an owning textbox | 0 |
| Chart types outside current column/doughnut families | 0 |
| DrawingML HSL color declaration | 0 |

The normal-autofit criterion was presence of an owning WPS textbox, not visible
glyph verification. The chart criterion does not count unsupported settings
within a supported chart type. Absence in these selected parts does not prove a
family is unnecessary, fully supported, absent from the excluded packages or
absent from Downloads. This limited evidence favors core corpus layout/recovery
work over these six less prevalent additions; it does not rank every remaining
gap or establish how many templates render correctly.

## Current corpus execution evidence (2026-10-09)

The fresh strict import audit
checked all 368 source packages on revision `d6e2c1cd`: 367 passed and one
rejected the existing `handmade1` page art border. Every source hash matches
the September 30 audit. Both packages excluded from the earlier bounded XML
prevalence scan were included and imported successfully here.

The painting smoke checks
also prepared and painted every page of the first twelve sorted sources without
reported paint or story-layout errors. The artistic-border source separately
painted three read-only pages with 92 paragraphs and four decoded images;
only its four unsupported border sides were reported as omitted. This confirms
structured recovery, not full appearance or editing fidelity.

Embedded font programs were kept opaque in both audits, with the browser guard
verified. The first birthday card now paints one Letter-sized page, matching the
fresh native reference page-count/geometry observation, but the reference uses Skeena and the browser
substitutes another face. Typography remains partial. These are execution
baselines, not additional completed-template counts or a runtime fix.

The subsequent full current painting checkpoint
completed all 368 sources and 916 page canvases on engine `e53829cf`, with zero
reported painting/readback or story-layout errors. Source hashes were rechecked
unchanged after completion. Every page count matches October 2. One source stays
read-only for its four omitted page-art borders. The available 66-source,
210-page pre-fix baseline retains exact pixels and eligibility; it does not
provide a full-corpus before/after pixel comparison. These execution checks do
not resolve native fidelity, font substitutions, editing/export or performance
fidelity, and promote no template to complete.

The typography follow-up
rechecks cover letter #81 on the current engine: all 22 checked body lines and
1,263 characters pair with the retained native PDF, and their captured positions
are unchanged from October 5. Horizontal drift still reaches 0.639pt; the source
remains partial. For resume #318, the historical Open Sans directory provides
TTF binaries, while the earliest editable source found declares version 2.010.
Corresponding source for the native reference's version 1.101 remains
unestablished. No font assets were replaced or renderer rules added.

## Remaining audit boundaries

A01 stays open for all unclassified nested declarations/attributes/value rules,
imported DrawingML/Math groups and wildcard content, package/relationship and
compatibility semantics, full story content models, Transitional legacy behavior
and vendor extensions. The backlog's checkboxes require appropriate runtime,
preservation/editing and native evidence before completion. No template was
certified complete by these documentation checkpoints.

## Body proofing exemptions (2026-10-10)

The noProof checkpoint records a generic
WML proofing fix with an independent nine-case native reference control. Five checked
originals lose 19 incorrect spelling marks; nine originals retain exact page
pixels and caret geometry across 50 pages. This is a bounded regression comparison
and does not certify those templates complete. Grammar, language selection and
proofing in other stories remain open in the run-property ledger.

The final strict-import regression
completed all 368 originals with unchanged eligibility and source hashes: 367
passed, and the known artistic-border source still rejects strict import.
Paragraph/table/asset counts match the prior checkpoint; all source files were
rehashed after the run. This does not establish native layout or performance fidelity.

## Picture resize editing (2026-10-10)

The picture resize checkpoint closes the
ordinary-picture gesture gap for absent/false `noChangeAspect` locks and fixes
rotated/aligned corner placement. Fourteen ordinary pictures across four originals
pass resizing and exact undo; ten independent controls cover the broader geometry.
Initial document rendering and corpus-completion counts are unchanged.

The retained-picture checkpoint
adds whole-object resizing for supported fixed-size standalone pictures with
custom clipping, outline/fill and effect scenes. It preserves their source shell,
physical effect parameters, crop and locks, rebuilding the scene at the new size.
All four previously protected pictures in the three checked originals now pass
resizing and exact undo (brochure 35, email-signature 3/14, pamphlet 84).

The native picture export checkpoint
confirms authored before/after frame dimensions, locks and physical effect
parameters in the reference application, and fixes invalid XML caused by repeated local namespace
aliases during main-document export. It does not certify native print pixels.

TODO: native resized-pixel/effect-padding fidelity, broader protected-scene
inventory, relative-size picture editing and internal group editing. These
editing checks do not certify those documents' complete rendering or close the
specification audit.

## Screen regression and mask counterexamples (2026-10-10)

The completed screen regression audit
checks all 368 original files and 916 pages around the physical-outline print fix.
All screen hashes and non-timing audit rows match; original package hashes remain
unchanged. This does not increase native-completion counts or close A01.

The single-matrix SVG-mask experiment matches the six native coefficient controls
and preserves complete RGBA hashes in the other 126 controls, but fresh direct-child
CSS and shifted-coordinate cases regress. The candidate remains rejected, with reproducible
probes described in the mask fixture README. Template #288 remains partial.

The fresh local-extent coordinate holdouts
reject a table-coordinate path that matched all 236 earlier raw observations:
three of 80 predictions frozen before the reference capture fail. Numeric table-range
captures preserve the page rectangles under translation, but do not establish
an independent rounding stage. Renderer arithmetic and completion counts remain
unchanged; full vertical print/native fidelity is still open.

The Calibri page/PDF placement investigation separates fresh native page header positions from retained PDF text origins. A new independent capitals/tracking control rules out a caps-specific spacing correction; original #81 remains partial. Screen metrics are unchanged.
