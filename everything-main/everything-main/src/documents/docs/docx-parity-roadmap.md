# DOCX support backlog

Current audit navigation and implementation priorities are collected in the
[specification audit index](spec-audit-index.md), including the explicitly bounded
corpus prevalence check. Declaration inventories are not template completion counts.

Audit date: 2026-09-29. Code baseline: `e6f1769168df368b38389cf47f3c2a64b312b2f2`.

Monorepo revalidation on 2026-10-09 (`d9e184e9`): S01–S04 now describe the
footnote, comment, revision and math code added since the first pass. Their
focused unit controls verify the stated limited model/import/export behavior;
native layout/visual coverage remains incomplete. Other entries still require
current-code revalidation. A01, the exhaustive element/property coverage ledger,
remains open; neither this update nor a template fix completes the spec audit.

This is a first-pass, specification-led backlog for the current canvas engine. It cross-checks the supplied ECMA-376 specifications against import, layout, painting, editing, and preservation code. It is not a declaration of exhaustive schema coverage or native-reference layout equivalence. A feature being retained in XML, or appearing in an XML property-order list, does not mean it is rendered or editable.

**First priority: an unsupported feature must not destroy the useful rendering of the rest of the document.** Improve that behavior before expanding individual feature families. Read-only mode can protect the source while still displaying its supported structure accurately.

No renderer changes are included in this audit. Performance concerns belong in notes attached to the affected feature; they should not displace rendering correctness work. Run verification locally. GitHub Actions remains disabled.

## How to use this list

- **Missing:** no native implementation in the inspected canvas path; a textual approximation or opaque XML preservation may exist.
- **Partial:** an implementation exists, but the stated subset is rejected, ignored, or restricted.
- **Verify:** evidence is insufficient to claim full support or a confirmed defect; first produce a focused control and classify the result.
- **Product:** editing or interaction support beyond simply displaying valid OOXML.

P0 is the recovery foundation. P1 covers document structure and common layout failures. P2 expands less common visual features and authoring. Priorities are an implementation order, not a claim about measured prevalence across all DOCX files. Each checkbox is a work package; some contain several related XML properties. Do not interpret their count as a count of unsupported OOXML elements.

Code links identify the evidence locations at the baseline above; function names and guard strings help locate the relevant behavior as files change. Unless stated otherwise, clause numbers refer to **ECMA-376 Part 1, fifth edition, December 2016**. Standards define document semantics; comparisons with native reference output are additionally needed for layout choices and extensions the standards leave open.

## P0 — preserve everything that can still render

Acceptance requirement clarified by the user: a single unsupported feature must not cause the viewer to abandon otherwise supported rendering. Treat failure containment as a requirement for every feature added below, not only as a separate recovery project.

Status checked against `96255ab6` on 2026-09-30: this requirement is still open.
`openCanvasDocument()` still escalates failed structured layout to
`DocxPackage.preview(pkg.parts)` and an empty decoded-image map. Prioritize
reproducible paths to that branch before new visual feature families; do not
close recovery work merely because the document opens or its text survives.

One further boundary is now contained: page-dependent fields in auto-sized
text boxes retain the affected box's saved extent, while healthy sibling shapes
continue to fit. The independent mixed-content control previously lost all four
decoded drawings and its table; it now retains them, with matching control
geometry and pixels at 75% and 100%. This is a disclosed approximation, not full
page-specific auto-sizing support. See the
[implementation](../src/engine/shape-autofit.js). Relative-page sizing and
other later fitting failures remain separate recovery candidates requiring
focused controls. R01–R06 and D03 remain open.

Floating tables in column flow now have a localized read-only recovery path.
An independent [paired mixed-content control](../tests/fixtures/floating-column-preview/README.md)
reproduces the previous whole-document text fallback. The preview keeps the
affected table inline at column start, retains its original floating declaration,
and preserves columns, healthy tables, pictures and page stories. Complete-page
pixels and geometry match the stated inline approximation at 75% and 100%.
Full column-floating placement/wrapping remains unsupported; square-wrapped
column drawings and broader R01–R06/D01 recovery remain open.

Relative-size/autofit escalation is now reproduced by an independent
[mixed-content control](../tests/fixtures/relative-autofit-recovery/README.md).
At `fb07b66e`, the unsupported source loses all four drawings, its table and
page stories, while the matched no-autofit control retains them. Validation
has already replaced four assets with fitted scenes before throwing; the
read-only retry therefore receives partially modified state. Resolve that
state boundary as part of local recovery rather than merely bypassing the
guard. Recovery now preserves the affected relative
scene before fitting, keeps normal relative placement, and continues fitting
other drawings. Prepared assets are published only after successful validation.
Grouped and standalone controls match the disclosed no-autofit approximation at
75% and 100%; full relative-frame autofit semantics remain open under D03.

- Recover at the smallest safe boundary: omit or approximate the failing property/object while retaining supported children, siblings, and surrounding document structure.
- Keep known dimensions and placement where safe. A placeholder should reserve known space; disclose when unknown geometry can change downstream pagination. Do not equate retained text with retained rendering.
- Keep successfully imported styles, numbering, sections, tables, page stories, and decoded assets through later layout failures. Whole-document text preview is the last resort when no safe structured recovery is possible, not the normal consequence of an unsupported feature.
- Explain what failed and what the viewer did about it in the partial-rendering banner. Read-only status protects editing; it is not a reason to discard visual content.
- For each recovery fix, compare a mixed-content document against a matched control with only the unsupported feature removed or replaced by the stated approximation. Assert unrelated content and formatting survive, and check geometry/pixels where the approximation should leave them unchanged. Include failures before and after healthy content, multiple failures, and original-byte download preservation.

Numbering structure recovery isolates missing/unsupported indexes, duplicate
numeric indexes and malformed override records without discarding healthy levels.
Full numbering overrides now match the native reference for conflicting child
indexes, deeper references, first counts, ancestor resets and explicit restarts.
The former expected failures are required passing checks: 180 native source rows,
216 browser-export rows and seven native page comparisons cover the implemented
subset. See [independent controls](../tests/fixtures/numbering-override-sequences/README.md).
Malformed declarations still recover read-only; R01–R06 and broader numbering
coverage remain open.

Negative paragraph offsets with top-and-bottom wrapping now recover locally in
a read-only display view. Affected pictures retain their signed placement with
wrapping omitted and the overlap risk disclosed; healthy pictures, tables,
body content and page stories survive. Three independent paired controls cover
body/header/footer failures before and after healthy content, with complete-page
pixel and geometry comparisons at 75% and 100%. Full negative-offset wrapping
remains open under D01; this is recovery, not editable layout support. See
[controls](../tests/fixtures/negative-wrap-recovery/README.md).

Next recovery triage: trace remaining exceptions that reach the final `DocxPackage.preview(pkg.parts)` branch in `openCanvasDocument()`. That branch still replaces structured content and returns an empty image map. Add a focused control for each reproducible escalation before implementing local recovery; distinguish an unsupported feature from an unexpected renderer defect in diagnostics. R01–R06 remain open until these boundaries are covered.

Manual line breaks in floating-picture anchor paragraphs now recover locally:
the affected pictures keep their placement with wrapping omitted and overlap
disclosed. Independent body/header/footer controls retain healthy rich content,
tables and ordinary wrapping, matching the no-wrap approximation at two zooms.
Page/column break combinations remain separate recovery candidates; full
manual-break wrapping remains open under D01. See
[controls](../tests/fixtures/manual-break-wrap/README.md).

Selected alternate run branches now recover their supported items even when the
branch contains several items or is empty. The former single-drawing guard
flattened the enclosing paragraph and removed healthy pictures. Nine paired
body/cell/header/footer controls retain full-page pixels and geometry at 75%
and 100%; nested branches and unsupported selected children have unit holdouts.
Editing arbitrary wrappers and broader MCE processing remain open. See
[controls and limits](../tests/fixtures/alternate-run-recovery/README.md).

Rotated-cell recovery (2026-09-30) now changes only identified failing cells to
horizontal in the read-only display view. The previous fallback changed every
rotated cell, including healthy cells elsewhere. Headers/footers now retain their
supported content and clearance under the same approximation, and the banner
includes their existing localized layout diagnostics. Paired controls preserve
healthy rotation geometry and pixels; full rotated hidden-mark/nested-table
support remains open.

Progress (2026-09-29): local recovery now covers image decode failures, unsupported table properties, failed cell blocks, unsupported page-setting flags, header/footer blocks and references, and failed list-label formatting. Supported surrounding content survives in read-only previews, with independent mixed-content controls and original-download checks. Failed list labels retain indentation, spacing and counter progression in body and header/footer content. R01/R02 remain open for other import/layout boundaries and visible placeholders; see [conformance notes](conformance.md#list-label-recovery-2026-09-29).

Style recovery now also isolates rejected run and paragraph property groups in document defaults, named styles and conditional table regions, preserving supported sibling formatting and numbering references. Structural style errors and later effective-format/layout failures remain open; see [paragraph-style recovery](conformance.md#paragraph-style-property-recovery-2026-09-29).

Recovery progress through `9aa963e4`: direct paragraph, paragraph-mark and run properties now use the same property-group isolation. A rejected drawing inside a mixed run retains neighboring text and supported pictures, including in cells and page stories. Where a rejected inline drawing has safe, valid, unrotated geometry, a visible placeholder reserves its authored extent and effect margins. These changes have focused unit, browser and independently generated fixture checks; they do not establish whole-corpus visual fidelity.

Rejected hyperlink destinations now retain their supported child text, formatting and pictures without an active destination in read-only previews, including cells and page stories. Controls cover unsupported document locations, missing relationships and disallowed target schemes; see [hyperlink destination recovery](conformance.md#hyperlink-destination-recovery-2026-09-29).

Rejected effective numbering definitions now retain the paragraph's rich content and available style/direct formatting instead of replacing the paragraph with plain text. Only the affected list participation is suppressed; supported neighboring lists retain their counters. Direct and inherited references, missing definitions/levels and overrides have independent body/cell/header controls. Unknown level geometry and cross-level counter effects remain open; see [numbering definition recovery](conformance.md#numbering-definition-recovery-2026-09-29).

Unsupported non-top vertical alignment with columns or continuous sections now uses an explicitly reported top-alignment approximation in read-only layout. Tables, pictures, styles, columns and page stories survive, source settings remain intact, and supported alignment on separate pages remains active. Full layout support for those combinations remains open under L03; see [section alignment recovery](conformance.md#section-alignment-recovery-2026-09-29).

Unsupported complete fields in headers/footers now retain their rich cached results and surrounding logos/formatting. Supported page fields remain live, including nested fields in retained results; instruction-only content stays hidden. Full field evaluation and unsupported envelope structures remain open under S05/S06; see [header/footer cached field recovery](conformance.md#headerfooter-cached-field-recovery-2026-09-29).

Continuous-section page-number restarts now retain rich layout in read-only previews. Only the unsupported restart is ignored, with a section-specific banner explaining that numbering continues. This also applies to live header/footer and drawing page fields; it avoids blank pages caused by the ignored restart and retains supported restarts on separate pages. Full continuous restart semantics remain open under L03; see [continuous numbering recovery](conformance.md#continuous-section-numbering-recovery-2026-09-29).

Rejected paragraph page breaks in table cells now retain supported rich runs, pictures and inherited formatting instead of replacing the paragraph with plain text. Read-only previews omit the break and report the affected package part; the original property remains intact. Header-cell clearance and painting use the same approximation. Position-dependent native pagination semantics remain open under B05; see [cell paragraph recovery](conformance.md#table-cell-paragraph-break-recovery-2026-09-29).

Malformed bookmark ranges now exclude only the invalid identifiers in read-only previews, preserving valid point, overlapping, cell and column ranges and their internal link targets. Missing endpoints are not invented and ambiguous identifiers are not reassigned. Source bytes remain intact. Unsupported enclosing structures and story bookmark scopes still need work; see [local bookmark recovery](conformance.md#local-bookmark-recovery-2026-09-29).

Tables in unequal-width columns now retain rich read-only previews using the first column's width for table measurement, while ordinary paragraphs preserve variable-width flow. The banner identifies each affected section/table. First/second-column and long-table controls cover retained pixels, geometry and original-byte download. Full table/column support remains open under L02; see [unequal-column table recovery](conformance.md#unequal-column-table-recovery-2026-09-29).

Decoded-picture failures now receive visible frame markers. Nested groups, picture-filled shapes and text boxes retain supported siblings and text when a source bitmap fails; cropped/rotated imported frames remain placed, and picture backgrounds retain the solid page color. See [decoded-picture recovery](conformance.md#decoded-picture-placeholders-and-scene-child-recovery-2026-09-29).

Page-border recovery now isolates rejected sides while retaining supported sides and common section settings. The banner names each omitted side; ambiguous container declarations still omit the whole border. Wave/art rendering remains unsupported. See [page-border side recovery](conformance.md#page-border-side-recovery-2026-09-29).

Missing, invalid and duplicate numbering identities now recover locally. Healthy lists retain their counters and rich content; ambiguous identities and their style links remain unavailable instead of selecting a first/last declaration. Independent controls verify matching healthy pixels and original downloads. See [numbering identity recovery](conformance.md#numbering-identity-recovery-2026-09-29).

Rejected style identities now recover through a private XML view shared by formatting and table readers. Missing IDs and all declarations of duplicate IDs are omitted; healthy defaults and styles survive. Companion styles cannot resurrect an ambiguous primary identity, and companion-only duplicates receive the same check. See [style identity recovery](conformance.md#style-identity-recovery-2026-09-29).

Cyclic style inheritance now recovers by omitting only links within cycles in the private preview view. Own declarations, valid descendant links, healthy styles, tables and surrounding content survive, including companion table styles. Eight independently authored paired controls match full-page pixels and body/header geometry; original downloads remain intact. This is a disclosed read-only approximation, not editable cycle support or a claim about other consumers' repair choices. See [cycle recovery](conformance.md#style-inheritance-cycle-recovery-2026-09-30).

Remaining recovery work includes later effective-format failures, numbering part/level/override structure failures, hyperlink child-structure and field wrapper failures, bookmark syntax inside unsupported enclosing structures, and layout failures that still escalate to a document-wide text preview. Floating or rotated drawings rejected before their geometry is imported, and drawings with invalid geometry, do not yet receive the inline placeholder. Keep R01–R06 open until their individual boundaries and interactions are covered. Corpus diagnostics should record timeouts separately from confirmed unsupported-feature recovery defects, and performance observations should remain notes unless they block correctness verification.

Hyperlink child recovery (2026-09-30) now projects an unrecognized inline child locally, preserving supported sibling pictures, formatting and link destinations. Permission markers and deleted-content controls cover body, cells, headers and footers. Rich content inside the unsupported child still has the limited text approximation; failures in recognized runs and field envelopes remain open.

Valid text-clearing breaks now retain `none`, `left`, `right` and `all` as editable semantic characters. LTR square-float clearance has native reference controls in body, headers and footers, including page boundaries and compatibility modes 12/15. Inline controls retain surrounding pictures, formatting and hyperlinks in cells as well. RTL, wrapped cell drawings, glossary placeholders and the separate paragraph-before-spacing interaction remain open. See [controls and scope](../tests/fixtures/clearing-break-wrapping/README.md).

The escalation at the audit baseline was concrete:

1. `DocxPackage.open()` tries strict import, then structured best-effort import.
2. If structured import also fails, `DocxPackage.preview()` substitutes preview paragraphs, default page settings, empty styles, and empty numbering.
3. `openCanvasDocument()` validates the whole layout and decodes the asset collection. A failure can reach that same document-wide preview and return an empty image map.
4. `previewParagraphs()` retains limited direct text formatting. It is an emergency readable-text path, not an adequate fallback for one unsupported object.

Evidence: [package opening and preview](../src/engine/docx.js), [layout/decode escalation](../src/engine/open-document.js), [text preview](../src/engine/docx-preview.js), [existing issue reporting](../src/engine/preview-issues.js). Some local recovery already exists, including inline handling and page stories; extend it rather than replacing everything indiscriminately.

- [ ] **R01 — Partial: contain import failures at the smallest meaningful boundary.** Recover an unsupported property, run, drawing, cell, table, or story independently. Keep supported siblings and their formatting; preserve opaque source XML. An unsupported cell property must not flatten the entire table or body. Start with `readInline`, block readers, and their catches in [docx.js](../src/engine/docx.js) and [table parsing](../src/engine/docx-tables.js).
- [ ] **R02 — Partial: decode assets independently.** One bad bitmap, unsupported metafile record, or drawing effect must not discard all decoded pictures. Use a local placeholder retaining authored extent and, where known, wrap geometry. Evidence: `decodedDocument()` in [open-document.js](../src/engine/open-document.js), [images.js](../src/engine/images.js).
- [ ] **R03 — Partial: retain layout structure during recovery.** Keep section/page dimensions, columns, styles, list state, tables, headers, and footers that were successfully read. Carry partial results forward instead of rebuilding from `DEFAULT_PAGE_SETTINGS` and empty collections. If a dimension is unknowable, disclose the local approximation. Evidence: `DocxPackage.preview()` and [page-story-layout.js](../src/engine/page-story-layout.js).
- [ ] **R04 — Partial: distinguish display limitations from edit safety.** A feature can force read-only mode without forcing a poor preview. Preserve the original download; do not enable a serializer that would erase unknown content. Later, evaluate protected opaque regions for safe editing around them, with explicit mutation/relationship rules. Evidence: [open-document.js](../src/engine/open-document.js), [model.js](../src/engine/model.js), [docx.js](../src/engine/docx.js).
- [ ] **R05 — Partial: report actionable, localized issues.** Extend the existing unsupported-feature banner with source part, feature, affected object/range, and actual recovery applied. Separate unsupported semantics from malformed input and resource limits. Deduplicate repeated symptoms without losing distinct affected locations. Evidence: [preview-issues.js](../src/engine/preview-issues.js).
- [ ] **R06 — Partial: mixed-feature recovery regression controls.** Into a supported rich document, independently inject an unsupported property, unsupported drawing, corrupt image, unsupported table property, and failing header story. Assert that unrelated paragraphs, images, tables, numbering, and sections survive. Compare unaffected geometry/pixels, verify original-byte download, and verify unsafe save remains unavailable. Include multiple simultaneous failures and bound recovery attempts.

## P1 — document stories, annotations, and fields

- [ ] **S01 — Partial: footnotes; missing endnote stories.** The monorepo now imports referenced footnotes, numbers them in reference order, reserves bottom-of-page note areas, and supports note editing/creation. Remaining work: section-level note properties, page/section numbering restarts, authored separators/continuation notices, splitting long notes, placement modes, custom reference marks and endnote stories. The reader rejects document-level noncontinuous numbering and custom marks; the layout uses a fixed separator and whole-note reservation. §§17.11; evidence: [footnotes.js](../src/engine/footnotes.js), [footnote-layout.js](../src/engine/footnote-layout.js), the notes-part reader in [docx.js](../src/engine/docx.js), and [footnotes.test.js](../tests/footnotes.test.js). Current unit controls do not establish native pagination fidelity for these remaining cases.
- [ ] **S02 — Partial: comments as annotations.** Range/point anchors, creation, replies, editing, resolving, deletion and unchanged-source preservation now exist, including `commentsExtended` reply/resolved metadata. Remaining work: rich comment-body display and safe editing rather than plain-text extraction, full modern comment identity/extensions, malformed companion recovery, and native controls for story scopes and overlapping anchors. §17.13.4 and vendor extensions; evidence: [docx-comments.js](../src/engine/docx-comments.js), [comments.js](../src/engine/comments.js), [comment-docx.test.js](../tests/comment-docx.test.js). Plain records and retained original XML do not prove rich comment rendering.
- [ ] **S03 — Partial: tracked revisions.** Insertions/deletions and paragraph-mark revisions now support display views, tracking, accept/reject, undo and round trips. Run/paragraph formatting revisions are retained, listed and can be accepted; rejecting formatting explicitly skips them because previous formatting is not restored. Move wrappers currently become insertion/deletion revisions and their range markers are ignored, so paired move identity/semantics remain unresolved. Table/section revisions and original-format views need focused controls. §17.13.5 and settings §17.15; evidence: [revisions.js](../src/engine/revisions.js), revision import in [docx.js](../src/engine/docx.js), `resolveRevisions` in [model.js](../src/engine/model.js), and [tracked-changes.test.js](../tests/tracked-changes.test.js). Keep the family open pending native display and mutation coverage.
- [ ] **S04 — Partial preservation and linear approximation: Office Math.** Inline/display OMML is retained as an atomic source object, displayed as linear text and preserved when surrounding text is edited. Mathematical typesetting remains missing: fractions, radicals, matrices, limits, equation alignment, control properties and math typography require real layout. Expression editing is also missing. §22.1; evidence: [office-math.js](../src/engine/office-math.js) and [office-math.test.js](../tests/office-math.test.js). Linear extraction is an approximation, not visual math fidelity.
- [ ] **S05 — Partial: general field instructions and cached results.** The current retained-field set already includes REF, SEQ, DATE, DOCPROPERTY and many other field families; retention is not evaluation. Implement missing IF/formula evaluation and general field semantics while preserving caches when evaluation is unavailable. Support valid nested instructions and structural boundaries. §17.16; evidence: [docx-body-fields.js](../src/engine/docx-body-fields.js), `RETAINED_FIELDS` in [docx-page-fields.js](../src/engine/docx-page-fields.js), [retained-fields.test.js](../tests/retained-fields.test.js).
- [ ] **S06 — Partial: field refresh and generated content.** Current explicit refresh handles basic body SEQ/REF, and the opening path separately refreshes requested PAGEREF fields. Remaining work: SEQ bookmark arguments, heading restart switch and unsupported formatting switches; REF combined numbering/position switches, formatting switches, self-reference error results and structural content; reliable dependencies and nested/locked-field sequence semantics; broader dirty/update-on-open behavior and TOC/index regeneration. Preserve authored caches when refresh is not requested. §§17.16.5.51, 17.16.5.56; evidence: [field-update.js](../src/engine/field-update.js), [open-document.js](../src/engine/open-document.js), [captions.test.js](../tests/captions.test.js), [sequence-fields.test.js](../tests/sequence-fields.test.js). Hidden SEQ counters, general-switch precedence, plain REF whitespace and basic relative REF position are now covered by focused controls; this is not full field refresh support.
- [ ] **S07 — Partial: full hyperlink destinations and page numbering.** Add external-address-plus-bookmark HYPERLINK destinations, document-location handling, and chapter-prefixed page numbering. §§17.16, 17.6; evidence: guard in [docx-body-fields.js](../src/engine/docx-body-fields.js), [docx-page-fields.js](../src/engine/docx-page-fields.js).
- [ ] **S08 — Missing: imported alternate content and subdocuments.** Handle `altChunk` using an explicit supported-format policy and merge its styles/relationships; provide bounded subdocument resolution. Never silently fetch external targets. §§17.17.1–2; evidence: closed block dispatch in [docx.js](../src/engine/docx.js).
- [ ] **S09 — Missing: bibliography and mail merge.** Preserve and display citation/bibliography field results and bibliography data; separately implement generation and user-directed merge against an authorized data source. §§22.6, 17.14, 17.16; evidence: field whitelist in [docx-body-fields.js](../src/engine/docx-body-fields.js). Data-source connection and merge authoring are product work, not prerequisites for displaying cached results.

## P1 — sections, flow, and paragraph layout

- [ ] **L01 — Partial: all section-break types.** Add odd-page, even-page, and next-column section starts, including blank-page/header/page-number behavior. Next-page and continuous already exist. §17.6.22; evidence: `section breaks other than nextPage or continuous` in [docx.js](../src/engine/docx.js), [page-settings.js](../src/engine/page-settings.js).
- [ ] **L02 — Partial: column interactions.** Unequal widths and separators already work; remove the remaining layout restrictions for tables in genuinely unequal columns and square-wrapped objects/floating tables in columns through actual layout support. §17.6.4 and drawing/table placement clauses; evidence: early guards in [layout.js](../src/engine/layout.js).
Column-count precedence for existing documents is now covered by independent legacy/modern controls: `num` selects active unequal columns (default one), contrary to §17.6.4. Original surplus entries stay preserved. Declared counts exceeding the available widths remain unresolved; see [count precedence](conformance.md#word-unequal-column-count-precedence-2026-09-29).

- [ ] **L03 — Partial: continuous-section interactions.** Different page geometry already has an implementation. Finish page-number restarts, non-top vertical alignment with columns/continuous sections, and native controls covering transitions with tables and page stories. §§17.6, 17.10; evidence: continuous/vertical-alignment guards in [layout.js](../src/engine/layout.js).
- [ ] **L04 — Partial: facing-page geometry and direction.** Implement mirror margins, RTL gutter, and vertical section text flow with correct inside/outside geometry. §§17.6, 17.15.1.57; evidence: `mirrorMargins`, `rtlGutter`, and vertical-page guards in `readPageSettings()` in [docx.js](../src/engine/docx.js).
- [ ] **L05 — Partial: paragraph frames; drop caps remain missing.** Generic top-level body/story grouping, placement, dimensions, wrapping and terminal anchors are implemented. Explicit cell frames, columns, section-ending anchors, hard breaks, bidirectional/vertical placement and complete native fidelity remain open. §17.3.1.11; evidence: [paragraph-frames.js](../src/engine/paragraph-frames.js), [fixture controls](../tests/fixtures/paragraph-frames/README.md).
- [ ] **L06 — Missing: document grid and line numbering.** Implement `docGrid`, applicable snap-to-grid behavior, `lnNumType`, restart/suppression, and column interactions. §§17.6.5, 17.6.8; evidence: page and paragraph property readers in [docx.js](../src/engine/docx.js). Retaining these declarations is not layout support.
- [ ] **L07 — Partial: hyphenation and line-breaking controls.** Implement automatic hyphenation settings, language-aware rules, zone/consecutive limits, and East Asian kinsoku/overflow-punctuation/spacing controls. §§17.3.1, 17.15.1.10/.22/.37/.53/.58/.59/.82; evidence: consumed properties in `paragraphProperties()` in [docx.js](../src/engine/docx.js). Check language-resource licensing independently.
- [ ] **L08 — Partial: paragraph direction, indents, and justification.** Complete explicit bidi paragraph semantics, mirrored/character-unit indents, distributed/Thai justification and Arabic kashida, plus justification after center/right/decimal tabs. Some bidirectional text handling already exists. §§17.3.1, 17.3.2; evidence: [formatting.js](../src/engine/formatting.js), [justification.js](../src/engine/justification.js), bidi guard in [docx.js](../src/engine/docx.js).
- [ ] **L09 — Partial: clearing breaks and compatibility layout.** Editable LTR `w:br/@clear` is supported beside square floats in body and page stories, with native boundary controls. Complete remaining RTL, cell-wrapping, placeholder and before-spacing gaps; support currently rejected top/bottom spacing and ANSI-kerning compatibility flags. Audit other compatibility settings by behavior. Part 1 §§17.3.3.1, 17.18.3; Part 4 §14.8; evidence: [native controls](../tests/fixtures/clearing-break-wrapping/README.md), `readPageSettings()` and break reader in [docx.js](../src/engine/docx.js).

## P1 — typography, styles, and numbering

- [x] **T06 — Supported: structured nonbreaking-hyphen elements.** `w:noBreakHyphen` now retains its semantic identity, measures/paints §17.3.3.18's hyphen-minus glyph and suppresses the hyphen break in layout and table minimum widths. The three mixed-content pairs retain all four bold linked pictures and stay editable. Native reference wrapping/advance controls, editing, exact undo and reopen checks cover the implemented subset; see [controls and limits](../tests/fixtures/nonbreaking-hyphen/README.md). Literal U+2011 remains distinct. This closes this valid-element content-loss path only; malformed/other unsupported run children and R01–R06 remain open.

- [ ] **T01 — Partial: hidden text and additional run properties.** Implement display/print policies for `vanish`/`webHidden`, `fitText`, emphasis marks, East Asian combined/vertical typography, and run borders/effects not consumed by `runProperties()`. §§17.3.2.10/.12/.14/.44 and related run properties; evidence: [formatting.js](../src/engine/formatting.js), [docx.js](../src/engine/docx.js). Preserve each supported property when another property is unfamiliar.
- [ ] **T02 — Missing: ruby/phonetic guides.** Keep base text and annotation as one layout construct with alignment, offset, and sizing; support selection and round-trip preservation. §17.3.3.25; evidence: inline dispatch in [docx.js](../src/engine/docx.js). Local unknown-child recovery now keeps healthy pictures/formatting around ruby and discloses an inline-text approximation; [paired controls](../tests/fixtures/unknown-run-child-recovery/README.md) verify containment, not ruby fidelity. T02 and broader R01–R06 remain open.
- [ ] **T03 — Partial: international and picture numbering.** Extend the eight entries in `NUMBER_FORMATS` to the remaining numbering systems; support custom formats, picture bullets, null labels, broader level paragraph/run properties, and complex-script markers. §§17.9, 17.18; evidence: [numbering.js](../src/engine/numbering.js), `readLevel()` in [docx-numbering.js](../src/engine/docx-numbering.js).
- [ ] **T04 — Verify: advanced typography and font metrics.** Audit OpenType number forms/spacing, stylistic sets and contextual alternatives separately from implemented ligatures; resolve existing kerning/spacing controls against native evidence. System and embedded font support already exists. §§17.8, 17.3.2 plus w14 typography extensions; evidence: [ligatures.js](../src/engine/ligatures.js), [font-metrics.js](../src/engine/font-metrics.js), [local-fonts.js](../src/engine/local-fonts.js), run reader in [docx.js](../src/engine/docx.js). Do not infer a defect solely from a PDF/screen difference.

  Confirmed font-version gap (2026-09-30): resume #318's native reference embeds Open Sans 1.101; named Light/SemiBold fallbacks use 3.003. Unicode-aligned comparisons show actual outline/advance differences. The historical Apache-2.0 release matches all 126 nonempty slots across three distinct embedded subsets, including unmapped glyphs; this does not establish complete rendering equivalence. See the read-only [comparison tool](../tools/compare-font-outlines.mjs). Before changing fallbacks: establish corresponding 1.101 source provenance, define family-wide version selection when DOCX provides no version, cover regular/bold/italic/bold-italic with independent native controls, and verify installed/embedded font priority plus generic Open Sans and corpus regressions. Keep this item open; neither font bytes nor rendering behavior changed in this audit. This is a font-resource compatibility issue, not a demonstrated OOXML semantic divergence.
  Script status (2026-09-30): static-font sizes, horizontal origins, and variable-font sizes with invariant required MVAR metrics now have native controls. Bundled Noto paint sizes match 36 native reference observations within 0.04 pt. Remaining work: resolve vertical script placement across the 200-case metric matrix, and interpolate instance-specific `sbys`, `spys`, and `spyo` when they vary. Those cases retain the existing fallback; this is not full script fidelity.

  Default installed-font metrics gap (2026-10-10): original corpus #88 paints its
  Segoe UI address superscript at 6 pt without local-font metadata, versus the native reference
  PDF-declared 6.48 pt. The existing authorized path paints at 6.5 pt and passes
  the native size tolerance. Resolve accurate generic script metrics where
  possible while retaining the browser's permission boundary; do not substitute
  a font-name/document-specific scale or trigger an import-time permission prompt.
  Default ink, fine glyph placement and image raster fidelity remain partial.

- [ ] **T05 — Verify: style inheritance and silent properties.** Build a property-level ledger for document defaults, paragraph/character/table/numbering styles, linked styles, theme values, and direct overrides. Classify each property as applied, preserved-only, ignored by the specification/native reference, rejected, or unknown. Existing style resolution is substantial; this is a completeness check, not a request to rewrite it. §17.7; evidence: [styles.js](../src/engine/styles.js), property readers in [docx.js](../src/engine/docx.js), [docx-tables.js](../src/engine/docx-tables.js).

## P1 — table completeness

- [ ] **B01 — Partial: nonzero cell spacing.** Implement separated cell boxes and their border/background conflict rules. Valid nonzero physical `tblCellSpacing` currently fails; ignored pct/auto declarations are already treated differently. §§17.4.43–45; evidence: `checkCellSpacing()` in [docx-tables.js](../src/engine/docx-tables.js).
- [ ] **B02 — Partial: remaining table/cell properties.** Add `bidiVisual`, `tcFitText`, remaining valid cell text directions, and border spacing. §§17.4, 17.4.67; evidence: table/cell property whitelists in [docx-tables.js](../src/engine/docx-tables.js), [cell-borders.js](../src/engine/cell-borders.js). Existing rotated cells, ordinary widths, merges, and AutoFit are not missing wholesale.
- [ ] **B03 — Partial: table style and omitted-grid combinations.** Support band sizes above three, valid currently rejected style-level grid/merge declarations, and vertical merges across rows with differing alignment. §§17.4, 17.7.6; evidence: `conditionalStyle()` and style guards in [docx-tables.js](../src/engine/docx-tables.js), [tables.js](../src/engine/tables.js). Use native controls where the native reference ignores an otherwise valid declaration.
- [ ] **B04 — Partial: floating-table pagination and collisions.** Expand multipage placements, interactions with other floats and page-story anchors, and nested floats whose parent splits across pages. §17.4 and native-reference placement behavior; evidence: [floating-table-flow.js](../src/engine/floating-table-flow.js), [nested-floating-tables.js](../src/engine/nested-floating-tables.js), [layout.js](../src/engine/layout.js). Multi-page failures now recover only the identified floating table into disclosed read-only ordinary flow; [paired controls](../tests/fixtures/multipage-floating-preview/README.md) verify retained rich content, screen/print pixels and original downloads. Native positioning remains open.
- [ ] **B05 — Partial: tables at structural boundaries.** Support safe tables inside persistent controls/field results and resolve currently rejected `pageBreakBefore` cases in cells without erasing the containing table. Explicit in-cell breaks already have support. §§17.4, 17.5, 17.16; evidence: cell/block readers in [docx.js](../src/engine/docx.js), guards in [model.js](../src/engine/model.js).
- [ ] **B06 — Product: edit tables with omitted grid columns.** Support insert/delete-column operations while retaining `gridBefore`/`gridAfter`, widths, spans, and merge topology. §17.4; evidence: insert/delete-column guards in [model.js](../src/engine/model.js). Rendering and structural editing need separate acceptance checks.

## P1/P2 — controls, custom XML, and protection

- [ ] **C01 — Partial, P1: content-control types.** Extend beyond the current rich/plain-text/picture/document-part subset to date, list/combo, checkbox, and repeating-section controls. Implement stored display content first, interactions second. §17.5.2 plus w14/w15 extensions; evidence: property whitelist in [docx-content-controls.js](../src/engine/docx-content-controls.js).
- [ ] **C02 — Partial, P1: control appearance, locks, and boundaries.** Support visible control appearances, lock semantics, controls enclosing tables, and legal edits across/inside boundaries. Hidden appearance and unlocked subsets already exist. §17.5.2 plus w14/w15 extensions; evidence: [docx-content-controls.js](../src/engine/docx-content-controls.js), [block-controls.js](../src/engine/block-controls.js), [model.js](../src/engine/model.js).
- [ ] **C03 — Partial, P2: custom XML and live binding.** Support currently unhandled custom-XML wrappers at run/block/row/cell scope, broader binding expressions and updates, while retaining unresolved bindings losslessly. §§17.5.1, 22.5; evidence: [docx-data-binding.js](../src/engine/docx-data-binding.js), dispatch in [docx.js](../src/engine/docx.js). Retained binding metadata does not mean a live data connection works.
- [ ] **C04 — Partial, P1: document protection and permission ranges.** Enforce applicable restrictions and editable ranges, distinguish enforced from inactive settings, and render protected documents fully. §§17.15.1.29/.93, 17.13.7; evidence: settings guard in [docx.js](../src/engine/docx.js). This is faithful restriction handling, not bypassing protection.
- [ ] **C05 — Product, P2: building blocks and glossary authoring.** Display and preserve existing document-part/control content, then support choosing/inserting/managing glossary entries. §17.12; evidence: `docPartObj`/placeholder handling in [docx-content-controls.js](../src/engine/docx-content-controls.js). Existing placeholder handling is not the full building-block UI.

## P1/P2 — drawings, graphics, and embedded objects

Open compound-line evidence (2026-09-30): [48 independent native controls](../tests/fixtures/open-compound-lines/README.md)
establish directed thick/thin sides and distinct flat/round/square endpoint
rules for straight and cubic paths. These now render without closing the contour
or rotating its seam, including the flat/rotated-line branch. Native contour,
viewer/edit/export, reflected-side and alpha checks cover the implemented subset;
closed-compound regression controls retain their previous output. Compound line
markers and explicit zero-width compound hairlines remain guarded. Native sharp
join, cusp, self-intersection, collapsed-contour, nonuniform nested-group and
open-dash endpoint coverage remains open under D02. This is rendering work,
not screen-stroke optimization or a corpus completion.

- [ ] **D01 — Partial, P1: floating placement and wrapping.** Add tight/through polygon wrap, remaining anchor-relative positions and overlap displacement, wrapped rotation/effect extents, and currently rejected cell/column/break combinations. `behindDoc` is already implemented. §§20.4, 17.3.3; evidence: [docx-anchors.js](../src/engine/docx-anchors.js), [drawing-collisions.js](../src/engine/drawing-collisions.js), [images.js](../src/engine/images.js), [layout.js](../src/engine/layout.js).

D01 follow-up (2026-09-30): cross-paragraph top-and-bottom wrapping now retains drawing bands in pagination instead of reserving their full height in the anchor paragraph. Following text and complete tables can occupy available space above a later picture; intersecting content clears it. Three independent native families cover 27 pages and 82 baselines, including paragraph before-spacing across thin rules and one-/three-/six-row tables. The original Project Summary drift is corrected (22 measured body lines now within 0.221 pt of the native reference). This does not close D01: polygon wrapping, rejected cell/column/break combinations and broader mixed-layout interactions still need controls. See [controls](../tests/fixtures/top-bottom-flow/README.md).

- [ ] **D02 — Partial, P2: shape geometry and fills.** Complete remaining preset shapes/adjustments and custom path fill modes; extend gradient paths and color transforms. Custom geometry guides already have an evaluator. §§20.1, 21.1; evidence: preset whitelist/custom path handling in [docx-shapes.js](../src/engine/docx-shapes.js), [drawing-gradients.js](../src/engine/drawing-gradients.js), [docx-drawing-style.js](../src/engine/docx-drawing-style.js), [docx-colors.js](../src/engine/docx-colors.js).
- [ ] **D03 — Partial, P1: text-box layout.** Add linked text boxes, multiple text columns, vertical text bodies, clipping/overflow modes, remaining autofit/relative-size combinations, and nontrivial text warps. §§20.4, 21.1 plus wps shape extensions; evidence: text-body/warp guards in [docx-shapes.js](../src/engine/docx-shapes.js). A recognized `vert` enum is not implemented vertical text layout when the text-box path subsequently rejects it.
- [ ] **D04 — Partial, P2: picture and text effects.** Complete unsupported picture effects, 3D cameras/materials/lighting/bevels and text-effect shaping. Preserve the base image/text when one effect cannot render. §§20.1, 21.1 plus w14 text-effect extensions; evidence: [docx-images.js](../src/engine/docx-images.js), [docx-picture-3d.js](../src/engine/docx-picture-3d.js), [text-3d.js](../src/engine/text-3d.js), [canvas-text-3d.js](../src/engine/canvas-text-3d.js). Some text declarations deliberately render flat today; do not describe them as a parser failure.
- [ ] **D05 — Partial, P2: remaining chart families.** Add horizontal bar, line, pie, area, scatter/bubble, radar, stock, surface, combination and 3D charts. Column and doughnut support already exists. §21.2; evidence: chart-type and `barDir` dispatch in [docx-charts.js](../src/engine/docx-charts.js).
- [ ] **D06 — Partial, P2: chart details and updates.** Add axis bounds/log/date/reversed scales, missing labels and legend placements, rich text, remaining rotations/crops, and data/cache update semantics. Column labels and axis scaling are narrow subsets. Workbook editing and chart authoring are a later product layer. §21.2; evidence: `axis()`, labels/legend validation in [docx-charts.js](../src/engine/docx-charts.js), chart restrictions in [images.js](../src/engine/images.js).
- [ ] **D07 — Partial, P2: SmartArt beyond supported layouts.** Expand algorithms/constraints, color distributions, connectors and text fitting; retain stored diagram-drawing fallback when regeneration is unavailable. §21.4; evidence: [diagram-layout-tree.js](../src/engine/diagram-layout-tree.js), [diagram-linear-geometry.js](../src/engine/diagram-linear-geometry.js), [diagram-styling.js](../src/engine/diagram-styling.js), [docx-diagram-drawing.js](../src/engine/docx-diagram-drawing.js).
- [ ] **D08 — Partial, P2: legacy VML and object previews.** Extend beyond the current background/legacy subsets to body VML shapes, text boxes, groups and wrapping; display embedded/linked-object cached previews with object identity and extents. Part 4 §19; Part 1 §17.3.3.19–21; evidence: inline dispatch in [docx.js](../src/engine/docx.js), [docx-preview.js](../src/engine/docx-preview.js). OLE/ActiveX execution is not required for useful document display.
- [ ] **D09 — Partial, P2: image-format fidelity.** Expand supported WMF/EMF records and text transforms, SVG effects/masks/compositing, and color-managed bitmap decoding. Preserve useful previews and report unsupported subfeatures locally. These are embedded-resource interoperability tasks, not all ECMA-376 requirements. Evidence: [wmf-images.js](../src/engine/wmf-images.js), [emf-images.js](../src/engine/emf-images.js), [emf-text.js](../src/engine/emf-text.js), [svg-images.js](../src/engine/svg-images.js). Resolve color-profile/font licensing before adding assets.
- [ ] **D10 — Partial, P2: borders and shading.** Complete unsupported pattern shading, border effects/spacing, and page art borders using lawful assets or original rendering. §§17.3.1, 17.4, 17.6; evidence: [docx-paragraph-shading.js](../src/engine/docx-paragraph-shading.js), [cell-borders.js](../src/engine/cell-borders.js), border readers in [docx.js](../src/engine/docx.js). Ordinary line borders and existing shading support should remain intact.

## P1/P2 — package and compatibility support

- [ ] **K01 — Missing, P1: Strict OOXML in the full codec.** Support Strict namespaces/relationship types and associated lexical differences throughout import and export, not just text preview. Part 1 and Part 4 conformance distinction; evidence: namespace guard in [docx.js](../src/engine/docx.js), Strict-aware [docx-preview.js](../src/engine/docx-preview.js).
- [ ] **K02 — Partial, P1: relationship-driven main-part discovery.** Follow the package office-document relationship instead of requiring `/word/document.xml`; validate targets and content types independently of fixed names. Part 2 §§6.2, 6.5; evidence: `DocxPackage.open()` in [docx.js](../src/engine/docx.js).
- [ ] **K03 — Partial, P1: complete markup-compatibility processing.** Implement inherited Ignorable/ProcessContent semantics, extension boundaries, and preservation rules appropriate to the document's MCE version. Keep correct first-understood-Choice selection and unknown MustUnderstand failure semantics. Part 3 §§7–9; evidence: [docx-compatibility.js](../src/engine/docx-compatibility.js). Failure inside a selected Choice is not permission to silently choose another branch as if it were conformant processing.
- [ ] **K04 — Partial, P2: signatures and adjacent WordprocessingML package types.** Provide accurate signed-document status and an explicit edit/invalidation policy. Separately evaluate read-only/template import for DOTX/DOCM/DOTM; those are adjacent format scope, not missing ordinary-DOCX conformance. Evidence: content-type/macros/signature guards in [docx.js](../src/engine/docx.js); Part 2 digital signatures. Preserve inert macro parts if such import is implemented; never execute them implicitly.
- [ ] **K05 — Verify, P2: metadata and extension coverage.** Inventory core/custom/extended properties, bibliography/custom-XML parts, vendor extension namespaces, and unknown relationships across a load/edit/save cycle. Confirm untouched-part preservation and distinguish preserved-only from exposed/editable metadata. Part 2 package metadata; Part 1 §§22.2–6; evidence: package serializer in [docx.js](../src/engine/docx.js), [docx-compatibility.js](../src/engine/docx-compatibility.js).

## P2 — authoring and interaction coverage

- [ ] **E01 — Product: editable section structure and stories.** Add safe insertion/deletion/editing of section boundaries and per-section settings, plus header/footer creation, linking/unlinking and currently restricted story content. §§17.6, 17.10; evidence: multisection settings/story save guards in [docx.js](../src/engine/docx.js), section-boundary mutation guards in [model.js](../src/engine/model.js).
- [ ] **E02 — Product: formatted clipboard.** Support interoperable rich-text/HTML copy and paste, including lists, tables, hyperlinks and images, with a plain-text fallback. Current handlers read/write `text/plain`. Evidence: [canvas-editor.js](../src/engine/canvas-editor.js). Sanitize imported markup while retaining supported formatting.
- [ ] **E03 — Verify/Product: rendered-object authoring coverage.** Map current UI commands to model operations for pictures, text boxes, shapes, charts and diagrams. Add missing insert/select/move/resize/property editing only after their round-trip model is safe. Evidence: [editor.js](../src/views/editor.js), [canvas-editor.js](../src/engine/canvas-editor.js), [model.js](../src/engine/model.js). Rendering support alone is not authoring support.
- [ ] **E04 — Verify/Product: semantic access and navigation.** Audit keyboard/screen-reader access to headings, tables, object alternative text, fields, controls, notes and annotations as those features land. Document the accessible representation separately from canvas paint. Evidence: [canvas-editor.js](../src/engine/canvas-editor.js), [editor.js](../src/views/editor.js). This is product accessibility scope, not a claim that every interaction is specified by ECMA-376.

## Completion criteria and follow-up audit

- [ ] **A01 — Verify: complete the element/property coverage ledger.** This skim finds feature families and concrete restrictions; it does not classify every schema element/attribute. Traverse applicable WML/DrawingML schema families and vendor extensions, mapping each to import, layout, paint, edit, export, and tests. Catch silently ignored properties as well as explicit rejection. Exclude presentation/spreadsheet features except resources embedded in DOCX documents.

  The [section-property ledger](section-property-coverage.md) now covers all 22
  direct `CT_SectPr` properties against the supplied Strict and Transitional
  schemas. Its reproducible inventory includes immediate attributes/children;
  nested types, shared types and extensions remain unaudited. This closes no
  rendering gap and does not complete A01. In particular, section note overrides,
  chapter page-number prefixes, grids and line numbering still lack behavior.

  The [paragraph-property ledger](paragraph-property-coverage.md) extends this
  audit to all 36 direct `CT_PPr` children. It separates silent East Asian/grid,
  direction/alignment and frame-flag gaps from implemented pagination, spacing,
  numbering and style subsets. Attribute-level and nested-context completeness
  remains open; a serializer ordering entry is not rendering support.

  The [run-property ledger](run-property-coverage.md) covers 40 direct `CT_RPr`
  property kinds. Legacy WML outline/shadow/emboss/imprint, run borders, emphasis,
  grid and East Asian combination behavior remain distinct gaps even where
  similarly named w14 effects exist. It also separates imported CS/RTL
  display from the restricted activation/authoring commands. Comparing Strict
  schema declarations does not mean Strict-namespace import is supported.

  The [table-property ledger](table-property-coverage.md) adds table, row, cell
  and row-level table-exception contexts. It records the Transitional-only
  `hMerge` declaration separately, existing span/vertical merge support, and
  explicit gaps for bidi tables, hidden rows, revisions, fitted cell text,
  accessible metadata and remaining table exceptions. Nested attributes,
  wrappers/grid revisions and complete style/structural-edit semantics remain
  open; property-name coverage is not an exhaustive table audit.

  The [numbering-property ledger](numbering-property-coverage.md) adds root,
  abstract-definition, level, instance and override contexts, including the
  Transitional-only legacy declaration. It separates supported restart/style
  binding behavior from missing picture bullets, formats, direction-aware
  alignment, context-specific formatting and retained template metadata.
  Nested attributes, extensions and combined story/edit behavior remain open.

  The [style-property ledger](style-property-coverage.md) adds named styles,
  document defaults and latent styles/exceptions, including owning metadata
  attributes. It distinguishes working inheritance/next-style behavior from
  missing linking, gallery metadata and latent-style consumers. Table-style
  property contexts, formatting protection and full nested semantics remain open.

  The [drawing-placement ledger](drawing-placement-property-coverage.md) adds
  inline/floating frames, positioning, wrap types/polygons and effect extents.
  It records existing layering/side-wrap/overlap/cell support separately from
  missing polygon wraps, coordinate bases, hidden drawings and extent semantics.
  Imported graphic payload types and vendor extensions require further audit.

  The [compatibility ledger](compatibility-property-coverage.md) inventories
  eight Strict / 66 Transitional switch declarations and named-setting
  attributes. It separates nine behavior flags, four explicit active omissions
  and 52 flags without an explicit consumer; defaults/mode behavior still needs
  controls. Complete nested settings and named-value semantics remain open.

  The [settings-root ledger](settings-property-coverage.md) inventories 96
  Strict / 98 Transitional declarations. It separates pagination/theme/story
  subsets from missing hyphenation, grid, note/field/proofing behavior and save
  metadata that is not a canvas-rendering feature. Nested attributes, extensions
  and every combined native/default behavior still need audit and controls.

  The [content-control ledger](content-control-property-coverage.md) inventories
  control properties and nested binding/text/placeholder/document-part/date/list/
  lock types. It separates existing text/picture/persistence behavior from missing
  types, standard WML bindings, locks, multiline and end-format semantics. Vendor
  extensions and complete wrapper/story/edit interactions remain open.

  The [math-property ledger](math-property-coverage.md) maps 21 global,
  paragraph and operator property types. It distinguishes a few linear tokens
  from missing professional layout, visibility, spacing, alignment and imported
  control-format semantics. Full math runs/arguments and equation editing remain
  open; atomic source preservation is not visual math fidelity.

  The [note-property ledger](note-property-coverage.md) adds document/section
  footnote/endnote settings, references and part containers. It records global
  footnote subsets separately from section overrides, custom separators,
  continuation and missing endnote stories. Full note body/context/identity
  and native pagination coverage remains open.

  The [field-code ledger](field-code-coverage.md) inventories all 72 numbered
  Part 1 field headings: 11 separately handled partial codes, 46 additional
  cached-only codes and 15 without a dedicated editable-body handler. It records
  current basic TOC generation separately from missing authored switch semantics,
  index generation, evaluation, dependencies and nested-instruction support.
  Part 4/extensions and the full field grammar remain open.

  The [comment/revision ledger](comment-revision-property-coverage.md)
  inventories 15 types' direct children and owning/inherited attributes in both
  WML variants. It records plain comment projection, lost move pairing, missing
  formatting rejection/restore, structural revision and displacement gaps.
  Rich stories, imported tracked content models and modern extensions remain open.

  The [inline run-content ledger](inline-run-content-coverage.md) maps 33 Strict
  and 34 Transitional run children plus primitive/object attributes. It separates
  existing break/tab/symbol/hyphen subsets from missing ruby, legacy dynamic
  content and embedded/link/control payloads. Wildcard VML/vendor contents,
  nested types and complete story/interaction semantics remain open.

  The [picture-payload ledger](picture-payload-property-coverage.md) inventories
  11 picture/image/metadata/lock/transform/fill types in both DrawingML variants.
  It separates accepted ordered effects, crop/transform and shape-fill subsets
  from missing effect kinds, ordinary tiling/destination rectangles, linked media,
  visibility and editing locks. Nested payloads and complete media support remain open.

  The [bookmark/hyperlink/range ledger](bookmark-hyperlink-range-coverage.md)
  inventories nine WML types in both variants. It separates supported marker,
  column and relationship behavior from missing displacement, nested hyperlink
  structures, sublocations/frames, permission ranges and alternative-format chunks.
  Full story/content models and nested imported semantics remain open.

  The [theme-structure ledger](theme-structure-coverage.md) inventories six
  root/scheme/collection/matrix types in both variants. It records lazy lookup,
  color-space/transform and script/font selection limits, object defaults,
  extra schemes, palette and theme-override gaps. Nested metadata, payloads and
  complete inheritance/extension semantics remain open.

  The [font-declaration metadata ledger](font-declaration-metadata-coverage.md)
  inventories nine WML types in both variants, including the Transitional-only
  charset val attribute. It distinguishes slot/theme/name/family lookup from
  missing characterSet, PANOSE, pitch and signature matching. Font programs,
  full selection/rendering and embedding validity/permission remain outside this audit.

  The [chart container/type ledger](chart-container-type-coverage.md) inventories
  six chart/plot/legend/layout types in both variants. It separates bounded cached
  vertical-column/doughnut support from missing types/combinations, axes, data,
  appearance and layout semantics. Nested properties, recalculation/editing and
  complete extension coverage remain open.

  The [shape/fill/outline ledger](shape-fill-outline-coverage.md) inventories
  11 shared DrawingML types in both variants. It records gradient flip/orientation/
  path limits, missing HSL/custom-dash/inset stroke behavior and narrower group
  fill/effect support. Nested geometry/colors/effects and full context interactions
  remain open.

  The [DrawingML text-body ledger](drawing-text-body-coverage.md) inventories
  six body/list/autofit types in both variants. It records active normal-fit,
  vertical/column/wrap/clip/decorations and list-style gaps, distinguishing WPS
  WordprocessingML paragraph text from chart DrawingML text. Full nested content and context
  interactions remain open.

  The [diagram-definition ledger](diagram-definition-coverage.md) inventories
  nine graph/definition/relationship types in both variants. It separates bounded
  flat linear recalculation from saved-drawing fallback, recording missing visible
  text, general algorithms, point geometry and full styling/color semantics.
  Nested layout/color/property and extension coverage remain open.
- [ ] **A02 — Verify: turn confirmed gaps into focused controls.** For each implementation task, attach a minimal independently authored DOCX, expected spec behavior, and native reference comparison where applicable. Reuse existing controls and expected-failure tests. Add combinatorial cases when layout features interact; ordinary schema validation alone cannot prove rendering fidelity.

A feature can be checked off only after its promised subset has import/display evidence, appropriate local tests, preservation/round-trip checks, and editing evidence if editing is claimed. Update `docs/conformance.md` with the supported subset and remaining limits. Do not call an entire family complete because one example works. Record native-reference divergences explicitly. For runtime changes, follow AGENTS.md's local unit/browser/build/conformance requirements; this documentation-only audit does not require a production build.

## Limits that are not requests to remove safeguards

Malformed relationships/XML, DTD/entity restrictions, cyclic references, unknown mandatory semantics, archive expansion limits, and bounded layout iteration are not simply missing formatting features. Resource ceilings (currently including ZIP size, entry count, expanded size, text length, and some table dimensions) should be tracked separately from standards support. Revisit legitimate large-document limits when required, while retaining abuse protections.

Likewise, macro execution, automatic external-resource fetching, bypassing document restrictions, and distributing unlicensed fonts/artwork are not implied by native display compatibility. Encrypted files are a separate authorized-unlock/import feature, not a reason to bypass protection. Local fallback must be honest about uncertainty and retain the original file.

## Source scope and review record

The supplied standards were read from a local copy. No proprietary document engine or implementation source was used. This backlog summarizes findings without reproducing the standards.

| Source | Areas skimmed and used |
| --- | --- |
| ECMA-376 Part 1, fifth edition, December 2016 | WML §17.2–17.18; DrawingML §20–21; math and shared features §22. Chapter outlines plus selected substantive clauses for frames, East Asian typography, ruby, cell fit, grids, line numbering, section types, notes, annotations, protection, alternate import, drawings, charts and math. |
| ECMA-376 Part 2, fifth edition, December 2021 | Package overview and abstract parts/relationships; metadata/signature scope. |
| ECMA-376 Part 3, fifth edition, December 2015 | MCE attributes, branch selection and semantic processing model, especially §§7.2–7.7 and 9.2–9.4. |
| ECMA-376 Part 4, fifth edition, December 2016 | Transitional overview, additional WML properties/settings and VML §19. |
| Current canvas source | Package/open/fallback paths; paragraph/run/section readers; numbering/styles; fields/controls; table and floating layout; drawings/charts/diagrams; images/fonts; editor/model restrictions. |

Reproducible skim entry points: Part 1 PDF pages 218, 283, 359, 472, 570, 583, 621, 756, 807, 938, 1026, 1308, 3108, 3375 and 3613; Part 2 pages 19–20 and 25; Part 3 pages 16, 18 and 25–27; Part 4 pages 50, 74 and 312, together with their outlines/front matter. These are one-based PDF pages, not printed page numbers. Clause references above also identify follow-up reading needed for implementation; they do not mean every page of each chapter was reviewed.

Modern vendor-only extensions, SVG/metafile formats, accessibility, and editor UI behavior require their own primary documentation and controls when implemented. They are explicitly identified above rather than presented as ECMA core requirements. Older conformance entries can describe historical restrictions that have since been lifted; current code and focused controls take precedence when triaging this backlog.

### L05 control and corpus triage update (2026-09-30)

Paragraph-frame placement remains missing and is now reproduced independently:
tests/fixtures/paragraph-frames contains five page/margin/style/grouping controls
with fresh hash-bound native reference frame metadata. The viewer uses ordinary paragraph
flow; five explicitly expected placement failures record the unresolved behavior.
A one-twip height difference produces two native frames rather than a shared
frame. Native PDF glyph positions remain unavailable while the existing page
capture is live. No placement compensation is justified by the reference automation API's property rounding.

Raw frame declarations are not an affected-template count. Current import
preserves 174 direct declarations in 16 sources, mostly default/inline or cell
forms; dimensioned fallback frames and unreferenced footer frames disappear from
that active set. Source-specific visual consequences remain unverified. Keep
L05 open for frames/drop caps and all their interaction cases; implement semantic
grouping and anchoring instead of removing declarations or fitting individual
templates.


### T04 font-version selection: coverage constraint (2026-10-01)

The complete-table Open Sans 1.100 rebuilds reproduce the native-matching
resume paint through WOFF, but globally replacing the named 3.003 aliases would
lose 127 cmap mappings per face (125 non-control characters). Retain the
current resources until document-scoped selection preserves required base and
variation-sequence coverage, installed/embedded/file priority and edit-time
refresh. PANOSE is useful matching evidence under ECMA-376 Part 1 §17.8.3.13, not a version identifier. Retain source metadata unchanged when the font is unavailable. Avoid
loading both versions merely to select one, and verify simultaneous documents,
four faces, combining marks and multilingual text before switching defaults.
Run `tools/audit-font-replacement.py` in addition to native outline/advance,
source/license and full rendering checks. This guard certifies repertoire only.
The original broad T04 requirements remain open.


Floating-table follow-up (2026-10-10): valid `tblpXSpec` inside/outside declarations
now retain their tables instead of failing ordinary-justification validation.
Single-page odd/even placement has independent native and editing controls; multi-page
positioning stays guarded because a guard-only candidate uses the wrong
horizontal side. This is partial floating-table progress, not exhaustive
conformance or a new original-template completion.
# 2026-10-10: absolute physical odd/even page side for multi-page floating tables

The new eleven-page inside/outside holdout disproves deriving the global odd/even
page side from `boundsOrigin`. Passing section offset plus local flow page (and
leading flow page) fixes the route-only candidate on both independent sources:
162 row identities/pages, maximum X 0.31 pt and baseline 0.06 pt. Carry that
coordinate explicitly through pagination before enabling horizontal aligned
flow. Next validate page/text anchors, legacy compatibility, numbering restarts,
different margins, leading flow and editing/undo/export/reopen; do not remove
the vertical/story/booklet/overlap guards from this evidence. The broad runtime
guard remains, and no corpus completion count changes.
# 2026-10-10: legacy aligned floating writing width

Fixed supported single-page top-level legacy floating alignment: subtract
exterior writing margins from the alignment width, without changing the grid,
numeric offsets, nested layout or modern positioning. Independent reversed
unequal-margin and center controls rule out single-margin/hardcoded-offset
patches. The same width is retained for booklet reprojection.

Long page/margin/text-anchor controls show multi-page support needs both this
resolved width and the absolute first-page odd/even side. That production guard remains;
next carry the resolved width and absolute coordinate through pagination and
validate numbering restarts, leading flow and editing/reopen before enabling it.
No original is promoted.

## 2026-10-10: horizontal aligned floating flow enabled

Completed the preceding carry-through work for top-level horizontal aligned
multi-page flow. Resolve first-fragment placement using section/global ordinal,
leading flow and the initial page-number side, retaining it on continuations.
Later numbering restarts are separately verified; zero remains a valid initial
number. Legacy writing width, numeric offsets and nested placement are retained.

Actual runtime native origins, edit/export/undo/print/reopen and rich UI checks
replace the historical route-only acceptance for horizontal alignment. Vertical,
booklet, story and prohibited-overlap combinations remain guarded. Mirrored
margins remain a separate unsupported feature; the two new native mirror
counterexamples are not supported-layout evidence. Full native ink, typography
and exhaustive collision/pagination coverage remain open. No original count
changes. Return to the partial originals after this validation checkpoint.
