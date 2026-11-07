# Bookmark, hyperlink and range-control coverage

Reviewed 2026-10-09 against code baseline `3675dcdb` and supplied ECMA-376
Part 1 WML schemas (bookmarks/permissions §17.13, hyperlinks §17.16, alternative
content §17.17 and proofing §17.13). This inventories nine types' direct child
declarations and owning/inherited attributes in Strict and Transitional variants.
It contributes to A01; nested types, full content models and vendor extensions
remain open. Strict inventory does not establish Strict package support.

Evidence: [docx-bookmarks.js](../src/engine/docx-bookmarks.js),
[bookmarks.js](../src/engine/bookmarks.js),
[column-bookmarks.js](../src/engine/column-bookmarks.js),
[docx-hyperlinks.js](../src/engine/docx-hyperlinks.js),
[hyperlinks.js](../src/engine/hyperlinks.js) and [docx.js](../src/engine/docx.js).
See also [field coverage](field-code-coverage.md),
[run content](inline-run-content-coverage.md),
[comment/revisions](comment-revision-property-coverage.md) and
[settings](settings-property-coverage.md).

Supported bookmark ranges survive text edits and source-marker export. Table
column bookmarks have a native-informed physical-cell resolver. Supported
hyperlinks preserve source/relationships and body text links. These are partial
context-specific features, not full range/content grammar support.

## Bookmark start

`CT_Bookmark`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Required numeric identity parsed/normalized and paired by bookmark model; duplicate/missing/reversed identities have strict validation and preview recovery paths. |
| `@displacedByCustomXml` | optional | next/prev validated and retained in source shell, but no displacement consumer in bookmark model. |
| `@colFirst` | optional | Optional schema declaration; reader requires both column hints together and uses them only in a table context. Native-informed physical-column resolver is partial. |
| `@colLast` | optional | Optional schema declaration; paired with colFirst by reader. Merged-cell/table-boundary interactions have focused controls, not complete context coverage. |
| `@name` | required | Required name retained; authoring uses separate checked-name rules. Complete imported-name/context behavior remains bounded. |

## Bookmark column range

`CT_BookmarkRange`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Shared inherited identity; start marker support described above. Shared type does not establish every enclosing context. |
| `@displacedByCustomXml` | optional | Retained/validated on supported bookmarks; custom XML displacement semantics missing. |
| `@colFirst` | optional | Shared column hint; paired reader restriction and partial physical-column selection described above. |
| `@colLast` | optional | Shared column hint; native-informed bounds/merges/selection described above. |

## Range end metadata

`CT_MarkupRange`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Parsed for supported bookmark endpoints; other shared-type contexts have separate readers and restrictions. |
| `@displacedByCustomXml` | optional | Supported bookmark endpoints retain/validate next/prev; no displacement consumer. |

## Hyperlink content

`CT_Hyperlink`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `customXml` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `smartTag` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `sdt` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `dir` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `bdo` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `r` | Partial supported run content with associated link, formatting and source shell; unsupported run items have their separate ledger. |
| `proofErr` | Completed body spelling consumes spellStart/spellEnd ranges; grammar and other-story display remain open. Body formatting retains source markers when text is unchanged. |
| `permStart` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `permEnd` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `bookmarkStart` | Partial identity/name/column marker parser and link association; structural/context restrictions remain. |
| `bookmarkEnd` | Partial bookmark endpoint parser and link association; full displacement semantics missing. |
| `moveFromRangeStart` | Skipped by run reader; linked move range semantics are missing. |
| `moveFromRangeEnd` | Skipped by run reader; linked move range semantics are missing. |
| `moveToRangeStart` | Skipped by run reader; linked move range semantics are missing. |
| `moveToRangeEnd` | Skipped by run reader; linked move range semantics are missing. |
| `commentRangeStart` | Body comment marker parser; unsupported in field instruction/drawing/page-story contexts. |
| `commentRangeEnd` | Body comment marker parser; unsupported in field instruction/drawing/page-story contexts. |
| `customXmlInsRangeStart` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlInsRangeEnd` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlDelRangeStart` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlDelRangeEnd` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlMoveFromRangeStart` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlMoveFromRangeEnd` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlMoveToRangeStart` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `customXmlMoveToRangeEnd` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `ins` | Partial tracked insertion wrapper; bounded nesting and content handling. |
| `del` | Partial tracked deletion wrapper; bounded nesting and content handling. |
| `moveFrom` | Mapped to deletion, without linked move identity/range semantics. |
| `moveTo` | Mapped to insertion, without linked move identity/range semantics. |
| `oMathPara` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `oMath` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `fldSimple` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `hyperlink` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |
| `subDoc` | No full hyperlink-child consumer; strict import rejects this nested item, while available visible text may be projected in read-only preview. Implement its structural/context semantics. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@tgtFrame` | optional | Retained imported shell attribute; not separately parsed into frame metadata by hyperlinkReader. Full target-frame navigation behavior remains missing. |
| `@tooltip` | optional | Read/stored; retained/exported with link metadata. Complete tooltip interaction/accessibility behavior needs context controls. |
| `@docLocation` | optional | Nonempty value explicitly rejects; implement sublocation semantics. |
| `@history` | optional | Validated and stored as boolean; no visited-state/navigation-history semantics established by this reader. |
| `@anchor` | optional | Internal bookmark destination when there is no relationship id; related target takes precedence when id is present. Full missing-target/context behavior remains bounded. |
| `@id` | optional | Imported relationship-id reference. Resolves exactly one external hyperlink relation of expected type; malformed/duplicate/unsupported targets reject; preview keeps usable contents without active link. |

## Permission start

`CT_PermStart`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |
| `@displacedByCustomXml` | optional | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |
| `@edGrp` | optional | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |
| `@ed` | optional | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |
| `@colFirst` | optional | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |
| `@colLast` | optional | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |

## Permission end

`CT_Perm`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |
| `@displacedByCustomXml` | optional | No permission-range import/enforcement model identified. Implement applicable editor/group/displacement/column scope and safe preservation; do not treat documentProtection handling as per-range support. |

## Alternative format chunk

`CT_AltChunk`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `altChunkPr` | No alternative-format chunk import/presentation model; source-preserving conversion and style matching remain missing. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | optional | Optional schema relationship-id reference; no alternative-format import consumer identified. |

## Alternative chunk properties

`CT_AltChunkPr`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `matchSrc` | No match-source-formatting consumer for imported chunks; implement appropriate format/style behavior. |

No owning attributes.

## Proofing range markers

`CT_ProofErr`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@type` | required | Required schema marker type. Supported body import validates the four boundary types and pairs each spelling start with the next end; unmatched anchors are ignored for display. |

## Feature work and scope limits

- Complete custom XML displacement and structural bookmark scopes, preserving
  marker ordering and legal ranges through edits. Existing columns/boundaries
  must not be reduced to a single contiguous text interval. Shared schema types
  are not proof that all enclosing stories and range uses are supported.
- Complete valid hyperlink child structures: nested hyperlinks, field/control
  wrappers, directional/custom XML content, math, related subdocuments and other
  legal declarations. The current hyperlink path sends most nested children to
  a run reader; top-level support for a feature does not prove this nested path.
  Keep supported text/objects usable when the destination is unsupported.
- Implement document sublocations, target frames and applicable history behavior;
  keep hyperlink relationships distinct from field-code HYPERLINK instructions.
  Complete story/context and invalid/missing destination behavior with controls.
- Implement permission ranges and proofing-marker state/display where relevant.
  Preserve permission semantics during edits; global document-protection rejection
  does not implement permission ranges. Body saved spelling is a bounded proofErr
  consumer; other stories and grammar remain open.
- Implement alternative-format chunk presentation/conversion and related
  subdocument content through valid package relationships. Preserve source and
  style/format context; no document-specific conversion or silent content loss.
- Inventory all nested type/value semantics, ordering, occurrences and imported
  relationships before declaring a family complete. Related WML/vendor extension
  ranges and package compatibility rules remain a separate broader audit.

All nine types' direct children and owning attribute names/use are checked in
both variants (18 type/variant checks). Child-row CLI verification uses
[audit-section-schema.py](../tools/audit-section-schema.py) with `--direct-only`,
`--type`, this ledger and the corresponding `--ledger-section` title.
Imported math element references retain their QName; their contents are not
resolved by this local WML inventory.

Existing focused controls include
[bookmarks.test.js](../tests/bookmarks.test.js),
[bookmark-recovery.test.js](../tests/bookmark-recovery.test.js),
[block-bookmark-docx.test.js](../tests/block-bookmark-docx.test.js),
[active-column-bookmarks.test.js](../tests/active-column-bookmarks.test.js),
[column-bookmarks-native.test.js](../tests/column-bookmarks-native.test.js) and
[canvas-hyperlinks.test.js](../tests/canvas-hyperlinks.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
