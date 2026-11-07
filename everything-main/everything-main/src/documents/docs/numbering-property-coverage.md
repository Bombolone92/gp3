# Numbering property coverage

Reviewed 2026-10-09 against baseline `42de0c65`, using supplied ECMA-376 Part 1
§17.9 schemas and Part 4 §14.6.2 legacy numbering. This contributes to roadmap
A01; it does not complete the spec audit. Strict and Transitional have four
root, seven abstract, two instance and two override child declarations. Levels
have eleven Strict children; Transitional adds `legacy`.

The importer requires the Transitional WML namespace. Schema-name coverage
does not establish Strict-package import support. This ledger covers direct
children and owning attributes; nested attributes, extensions and combined
style/story/edit behavior still need controls. Retention is not implementation.

Untouched numbering parts survive supported edits. New lists append definitions;
restarting imported lists clones instance XML and patches affected starts.
This is targeted preservation, not a general editor for all numbering metadata.
Import/export evidence is [docx-numbering.js](../src/engine/docx-numbering.js);
counters/geometry are [numbering.js](../src/engine/numbering.js), editing is
[model.js](../src/engine/model.js). Test links below identify existing controls,
not a claim that they were rerun during this documentation-only audit.

## Numbering root

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `numPicBullet` | Retained, no picture-bullet consumer. | Implement image relationships, geometry, marker painting and editing controls. |
| `abstractNum` | Partial: indexed levels, validated identities and style links. | Complete nested semantics; [numbering-identity-recovery.test.js](../tests/numbering-identity-recovery.test.js). |
| `num` | Partial: abstract reference, overrides and source instance XML. | Complete instance/extension semantics; [numbering-override-sequences.test.js](../tests/numbering-override-sequences.test.js). |
| `numIdMacAtCleanup` | Retained allocation metadata, no model consumer; writer inserts before it. | Verify allocation/cleanup interoperability; not printed-label formatting. |

CT_Numbering has no own attributes in these schemas.

## Abstract definitions

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `nsid` | Retained, no consumer. | Cross-document identity/copy-paste controls. |
| `multiLevelType` | Imports retain it without branching; generated definitions use multilevel. | Verify single-level/hybrid behavior and authoring. |
| `tmpl` | Retained template metadata, no consumer. | Template/gallery interoperability and authoring. |
| `name` | Retained, not exposed as a named list. | Named-list UI and reusable definition editing. |
| `styleLink` | Partial: backlink used in numbering-style resolution. | Full association/authoring; [linked-numbering.test.js](../tests/linked-numbering.test.js). |
| `numStyleLink` | Partial: resolves style inheritance/backlinks, validates ambiguity/cycles and retains caller counter identity. | Underlying abstract levels are used rather than style instance overrides; [linked-numbering.test.js](../tests/linked-numbering.test.js). |
| `lvl` | Partial: indexed levels 0–8 and local unsupported-level recovery. | Complete level semantics below; [numbering-level-recovery.test.js](../tests/numbering-level-recovery.test.js). |

Own attribute `abstractNumId` is consumed and validated. Ambiguous identities
are unavailable instead of selecting arbitrary source definitions. Vendor
extensions such as restart-after-break are outside these schema inventories;
no consumer was found in the numbering path.

## Levels

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `start` | Partial: nonnegative integer up to 1,000,000; absent import defaults to zero. | Wider values and combined override inheritance; [numbering-override-sequences.test.js](../tests/numbering-override-sequences.test.js). |
| `numFmt` | Partial: bullet, decimal, decimalZero, lower/upper letter, lower/upper Roman, none. Custom format attribute rejects. | Remaining locale/script/ordinal/textual formats. Roman labels are bounded to 1–3999; alphabetic labels to 128 characters. |
| `lvlRestart` | Partial: ancestor-driven restart, zero/no restart and instance overrides. | Full story/extension restart controls; [inherited-list-restarts.test.js](../tests/inherited-list-restarts.test.js). |
| `pStyle` | Partial: active/inactive style bindings and indent precedence. | Combined cases; [numbering-style-bindings.test.js](../tests/numbering-style-bindings.test.js), [list-style-indents.test.js](../tests/list-style-indents.test.js). |
| `isLgl` | Partial: referenced numeric labels use decimal; bullet/none have no numeric substitution. | Locale/script combinations; `listMarkers` in numbering.js. |
| `suff` | Partial: tab, space and nothing. | Combined direction/alignment/geometry controls; [canvas-numbering.test.js](../tests/canvas-numbering.test.js). |
| `lvlText` | Partial: literals and %1–%9 references; length bounded; null-symbol case rejects. Deeper references suppress labels in the native-compatible subset. | Full null/reference/override semantics; [numbering-override-index.test.js](../tests/numbering-override-index.test.js), [none-numbering.test.js](../tests/none-numbering.test.js). |
| `lvlPicBulletId` | Unsupported: level whitelist rejects it. | Resolve and paint picture markers; inline-image support does not cover this. |
| `lvlJc` | Partial: left/center/right; start/end mapped to physical LTR sides. | Direction-aware logical alignment and bidi markers. |
| `pPr` | Partial: level whitelist accepts only ind, tabs and contextualSpacing. | Apply remaining applicable paragraph formatting in this context; body support is not sufficient. |
| `rPr` | Partial: fonts/language, ordinary bold/italic, capitalization, strike, color, size, underline, shading, vertical position, spacing, scale, kerning. | Remaining properties/effects and full CS markers; [symbol-cs-numbering.test.js](../tests/symbol-cs-numbering.test.js). |

Own attributes: `ilvl` is consumed and bounded to 0–8. `tplc` and `tentative`
are retained without a model/UI consumer; their template and tentative-level
semantics remain open. Sizes use integer half points here, not general physical
units. Complex-script declarations are accepted only for restricted safe marker
characters; accepting inactive CS declarations is not full CS label formatting.

## Transitional level addition

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `legacy` | Partial: enabled indentation/space, including physical distances. Absent flag is off for native compatibility despite the Part 4 default. | Maintain independently authored/native controls; [canvas-legacy-numbering.test.js](../tests/canvas-legacy-numbering.test.js). Combined legacy/modern semantics remain open. |

## Instances

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `abstractNumId` | Partial: definition resolution and missing/invalid identity errors. | Cross-document remapping and linked combinations; [numbering-definition-recovery.test.js](../tests/numbering-definition-recovery.test.js). |
| `lvlOverride` | Partial: indexed full levels/start overrides; invalid overrides do not silently use the base level. | Complete nested/edit semantics; [numbering-override-sequences.test.js](../tests/numbering-override-sequences.test.js). |

Own attribute `numId` is consumed and validated. Counters share abstract identity
in the implemented native compatibility path; start overrides apply on first
encounter of that instance. Empty section-break paragraphs do not advance the
list. These cases do not prove all story/section restart semantics.

## Overrides

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `startOverride` | Partial: bounded start/full-child precedence; user restarts serialize targeted changes. | Combined inheritance and preservation; [numbering-override-sequences.test.js](../tests/numbering-override-sequences.test.js). |
| `lvl` | Partial: replacement formatting and distinct initial/restart starts; conflicting child index yields empty replacement; deeper references discard the override in the native-compatible path. | Preserve divergence controls and broaden properties; [numbering-override-index.test.js](../tests/numbering-override-index.test.js). |

Own attribute `ilvl` is consumed and bounded to 0–8. Restart editing can remove
an ignored full child or update its explicit start at the edited level; unrelated
source overrides survive. Do not claim edited definitions are byte-identical.

## Verification and next work

Use [audit-section-schema.py](../tools/audit-section-schema.py) with `--type` and
`--ledger-section` for CT_Numbering, CT_AbstractNum, CT_Lvl, CT_Num and CT_NumLvl.
For Transitional CT_Lvl combine Levels and Transitional level addition. Supplied
schema hashes: Strict `44fc2233c5df2cfbe0b3b50e7024bd8412ec99dfe7176313ef58845fdec5498d`,
Transitional `0f7784b36ddc42950e5ff354cd608b83b60e4de39325d5568913f1225365029b`.

All ten type/variant inventories matched the ledger's direct child rows, without
missing, extra or duplicate entries. Owning attribute names were also inspected
against the prose above, and all relative evidence links resolved. These checks
verify inventory completeness at the stated boundary, not runtime semantics.

Prioritize picture bullets, remaining formats, direction-aware markers and
numbering-context formatting. Extension restarts, template metadata and
cross-document identities also need authored controls. Direct declaration
coverage is not full OOXML conformance or native-reference compatibility.
