# Structured document control property coverage

Reviewed 2026-10-09 against baseline `a3d07867`, using supplied ECMA-376
Part 1 §17.5.2 schemas. Both variants declare 23 CT_SdtPr child kinds.
This contributes to roadmap A01, not complete control/story/extension support.
The runtime expects Transitional WML. Shared names do not imply Strict-package
support or identical semantics in inline, block, row and cell contexts.

Evidence: [docx-content-controls.js](../src/engine/docx-content-controls.js),
[content-controls.js](../src/engine/content-controls.js),
[block-controls.js](../src/engine/block-controls.js),
[plain-text-controls.js](../src/engine/plain-text-controls.js),
[picture-controls.js](../src/engine/picture-controls.js),
[docx-data-binding.js](../src/engine/docx-data-binding.js),
[docx-block-controls.js](../src/engine/docx-block-controls.js) and control
import/export in [docx.js](../src/engine/docx.js).
Untouched shells retain source properties; typing/formatting/structural edits
can update or remove wrappers according to the supported persistence rules.
Retention does not establish active behavior.

Unsupported controls can project saved sdtContent in a disposable read-only DOM.
Retained page-story/textbox paths validate envelopes before projection and
preserve original package parts. Child content still needs supported readers;
projection is not guaranteed recovery of every unsupported nested structure,
nor an implementation of the omitted interaction/binding semantics.

## Control properties

CT_SdtPr

| Property | Current behavior / remaining work |
| --- | --- |
| `rPr` | Partial: supported input run formatting parsed; plain-control formatting can update input properties. Full formatting/context/authoring coverage remains open. |
| `alias` | Validated and retained; not exposed as a general control title/management property in the model. |
| `tag` | Validated and retained; no semantic tag lookup/authoring consumer. |
| `id` | Validated signed 32-bit identity with duplicate guard; generated model identity differs from stored ID. Complete cross-story/copy/merge identity lifecycle remains open. |
| `lock` | Only explicit unlocked accepted; active lock modes and absent val reject. Implement distinct wrapper/content locking with selective safe editing. |
| `placeholder` | Partial: referenced glossary text prompts, including bounded paragraphs/bookmarks. Unsupported non-text placeholder structures reject. |
| `temporary` | Partial: on controls remove wrapper after supported content changes; picture geometry/description formatting retains temporary identity in native-compatible subset. Combined edit cases remain open. |
| `showingPlcHdr` | Partial: cached placeholder state, replacement/restore and export flag updates. Not full document-wide placeholder preference support. |
| `dataBinding` | Unsupported standard WML declaration: property whitelist rejects. Newer W15 binding path is a separate bounded unresolved-only case below. |
| `label` | Unsupported by editable reader whitelist; saved display may project in read-only preview. Label semantics/authoring remain open. |
| `tabIndex` | Unsupported by whitelist. Implement tab navigation order and accessibility with nested controls. |
| `equation` | Unsupported control type. Retained OMML linear projection elsewhere is not equation-control interaction support. |
| `comboBox` | Unsupported control type. Implement stored list/last value, editable choice input and binding interactions. |
| `date` | Unsupported control type. Implement stored display/date/calendar/mapping semantics and date selection. |
| `docPartObj` | Partial: saved building-block contents are editable in supported contexts; gallery/category/unique metadata retained. Not a building-block picker/catalog implementation. |
| `docPartList` | Unsupported control type; complete document-part list/catalog and selection behavior remain open. |
| `dropDownList` | Unsupported control type. Implement choice display/value, selection and round-trip semantics. |
| `picture` | Partial: inline picture wrappers, supported image contents and preservation/edit behavior. Block picture wrappers reject; image/shape restrictions still apply. |
| `richText` | Partial: persistent/temporary rich content in supported inline/block/cell contexts. Persistent tables, some nesting/field boundaries and structural edits remain restricted. |
| `text` | Partial: plain text, whole-control formatting and placeholder behavior. Multiple actual paragraphs, mixed formatting and non-text objects restricted; multiLine behavior gap below. |
| `citation` | Unsupported control type. Cached citation fields do not implement citation source/control workflows. |
| `group` | Unsupported control type. Grouped locking/boundary and nested interactions remain open. |
| `bibliography` | Unsupported control type. Cached bibliography content is not bibliography generation/interaction support. |

CT_SdtPr has no own attributes. The reader rejects duplicate property names
and conflicting supported types. Schema choices/order/applicability require
additional controls; this inventory does not validate every combination.

## End properties

CT_SdtEndPr

| Property | Current behavior / remaining work |
| --- | --- |
| `rPr` | Validated and retained, without a separate end-format model consumer. Reader accepts at most one record; schema parent choice is repeatable. Repeated declarations and effective end formatting need controls. |

CT_SdtEndPr has no own attributes. Parent choice occurrence is not captured
by a simple direct-name count; this restriction was checked against the schema
structure as well as the reader.

## Data binding

CT_DataBinding has no direct children.

### Binding attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@prefixMappings` | Standard WML parent rejects. W15 path parses namespace mappings for its limited XPath check; active synchronization and full namespace/XPath behavior absent. |
| `@xpath` | Standard parent rejects. W15 path only permits absolute child-name steps with optional positive index; any matching package store rejects active XML mapping. |
| `@storeItemID` | Standard parent rejects. W15 path validates GUID but checks all related custom XML stores, reflecting existing fallback compatibility. No active store synchronization/authoring. |

Unresolved W15 bindings are editable only after proving the supported XPath
selects nothing in every package store. External/invalid/missing custom XML
relationships reject. This is not permission to ignore active mappings.

## Plain text

CT_SdtText has no direct children.

### Text attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@multiLine` | Validated and stored as a boolean; no dedicated downstream flag consumer found. Implement line-break/input restrictions and allowed multiline behavior with native controls. |

## Placeholder

CT_Placeholder

| Property | Current behavior / remaining work |
| --- | --- |
| `docPart` | Partial: glossary name lookup for text-only prompts and supported bookmarks/breaks. Broader glossary bodies, styles, identity and editing need controls. |

CT_Placeholder has no own attributes.

## Document parts

CT_SdtDocPart

| Property | Current behavior / remaining work |
| --- | --- |
| `docPartGallery` | Validated and retained for supported docPartObj; no gallery/catalog UI. docPartList parent remains unsupported. |
| `docPartCategory` | Validated and retained metadata; no category selection/filter behavior. |
| `docPartUnique` | Validated on/off and retained; no full catalog uniqueness workflow. Existing reader preserves the alternative property order some producers write, unlike the schema sequence. |

CT_SdtDocPart has no own attributes. The existing ordering compatibility case
is documented by [docpart-object.test.js](../tests/docpart-object.test.js);
this audit adds no new native divergence claim.

## Date controls

CT_SdtDate

| Property | Current behavior / remaining work |
| --- | --- |
| `dateFormat` | Unsupported parent control; implement localized display formatting and editing. |
| `lid` | Unsupported parent; implement language/locale behavior. |
| `storeMappedDataAs` | Unsupported parent; implement date mapping representation and synchronization semantics. |
| `calendar` | Unsupported parent; implement calendar-specific display/selection and default behavior. |

### Date attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@fullDate` | Unsupported parent; retained source value is not parsed date/control support. Validate and apply complete date-time semantics. |

## Combo boxes

CT_SdtComboBox

| Property | Current behavior / remaining work |
| --- | --- |
| `listItem` | Unsupported parent; implement text input/choice display and stored value semantics. |

### Combo attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@lastValue` | Unsupported parent; implement last value/default selection and free-text interaction. |

## Dropdown lists

CT_SdtDropDownList

| Property | Current behavior / remaining work |
| --- | --- |
| `listItem` | Unsupported parent; implement choice selection and display/value mapping. |

### Dropdown attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@lastValue` | Unsupported parent; implement saved/default selection semantics. |

## List items

CT_SdtListItem has no direct children.

### Item attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@displayText` | Unsupported list/combo parents; implement display fallback, duplicate and empty label controls. |
| `@value` | Unsupported parents; implement selected/stored/bound value semantics and preservation. |

## Locks

CT_Lock has no direct children.

### Lock attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@val` | Reader requires explicit unlocked; optional absent val and active lock modes reject. Implement default semantics and separate wrapper/content locks. |

## Extension and context boundaries

The w14 checkbox, w15 repeating-section/item and visible appearance/adornment controls
are outside these base types. The editable reader accepts only hidden W15
appearance and its bounded dataBinding case; other property extensions reject.
Hidden appearance suppresses active control framing, not saved document text.
Do not infer extension support from read-only saved-content projection.

Editable control count is bounded at 2,000; retained-story projection additionally
bounds nesting at twelve. Inline fields cannot cross control boundaries or place
controls inside field instructions. Persistent wrappers around tables and some
nested cell/block structures reject. Row wrappers and full nested/overlapping
selection/editing semantics require separate structural ledgers and controls.

The CT_SdtRun/Block/Cell/Row schema wrappers make sdtPr and sdtContent optional.
The editable reader requires both; omitted properties/content need default and
empty-control controls rather than blanket rejection. Table row wrappers are
outside the editable row-reader subset. These wrapper observations are from the
schema structure/source paths, not a complete content-model inventory.

Existing controls include [canvas-content-controls.test.js](../tests/canvas-content-controls.test.js),
[persistent-inline-controls.test.js](../tests/persistent-inline-controls.test.js),
[persistent-block-controls.test.js](../tests/persistent-block-controls.test.js),
[persistent-cell-controls.test.js](../tests/persistent-cell-controls.test.js),
[plain-text-controls.test.js](../tests/plain-text-controls.test.js),
[picture-controls.test.js](../tests/picture-controls.test.js),
[docx-data-binding.test.js](../tests/docx-data-binding.test.js),
[retained-story-controls.test.js](../tests/retained-story-controls.test.js) and
[retained-textbox-controls.test.js](../tests/retained-textbox-controls.test.js).
These identify existing evidence; no new runtime/native test run is claimed here.

Prioritize stored-content recovery, list/date/checkbox interactions, active
bindings, locks and multiline/end-format controls. Saved display must survive
unsupported interactions and original source must remain downloadable.
Independently authored files and native controls are needed before implementation
claims, especially for lock, placeholder, wrapper persistence and binding defaults.

## Inventory verification

Use [audit-section-schema.py](../tools/audit-section-schema.py) to check each
named type against both supplied WML variants and its section above. Attribute
tables use @ names, separate from child declarations. WML hashes are recorded
in [numbering-property-coverage.md](numbering-property-coverage.md).
Nested attributes/types, parent occurrences, all extension declarations and
combined story/editor behavior are not completed by matching name sets.

All 22 type/variant checks matched child and own-attribute row sets without
missing, extra or duplicate names. All relative evidence links resolved.
Parent-occurrence and optional-wrapper observations were checked separately
against schema structure; these checks do not establish native rendering fidelity.
