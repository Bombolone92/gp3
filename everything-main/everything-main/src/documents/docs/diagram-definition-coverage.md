# Diagram data and definition coverage

Reviewed 2026-10-09 against code baseline `83be7f97` and supplied ECMA-376
Part 1 §21.4 diagram schemas and Transitional variant. This inventories nine
root/graph/definition types' direct children and owning attributes. It contributes
to A01, not all layout algorithms, properties, color lists, text or extensions.
Strict inventories do not establish Strict package support.

Evidence: [docx-diagram-drawing.js](../src/engine/docx-diagram-drawing.js),
[docx-diagram-layout.js](../src/engine/docx-diagram-layout.js),
[diagram-data-model.js](../src/engine/diagram-data-model.js),
[diagram-layout-tree.js](../src/engine/diagram-layout-tree.js),
[diagram-linear-geometry.js](../src/engine/diagram-linear-geometry.js) and
[diagram-styling.js](../src/engine/diagram-styling.js).
The importer first attempts bounded data-driven recalculation. Read-only preview
can fall back to a saved diagram drawing part (the `dsp:` drawing cache) when recalculation rejects;
the cache adapter has its own limits. Neither path establishes full SmartArt
layout, visible text, authoring or diagram data editing.

## Diagram relationships

`CT_RelIds`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@dm` | required | Required relationship resolved as exactly one internal expected-type/content-type part with valid root; source parts retained. This does not evaluate the referenced model/layout/style. |
| `@lo` | required | Required relationship resolved as exactly one internal expected-type/content-type part with valid root; source parts retained. This does not evaluate the referenced model/layout/style. |
| `@qs` | required | Required relationship resolved as exactly one internal expected-type/content-type part with valid root; source parts retained. This does not evaluate the referenced model/layout/style. |
| `@cs` | required | Required relationship resolved as exactly one internal expected-type/content-type part with valid root; source parts retained. This does not evaluate the referenced model/layout/style. |

## Data model

`CT_DataModel`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `ptLst` | Partial point graph reader with one document root and supported point types; full point properties/text/geometry missing. |
| `cxnLst` | Partial typed graph and endpoint/parent/transition validation, including native-informed ordering; full graph/layout semantics bounded. |
| `bg` | Recalculation permits only neutral background/noFill; active background formatting rejects. |
| `whole` | Recalculation permits empty whole-diagram properties only; active formatting rejects. |
| `extLst` | Saved-drawing fallback locates one recognized diagramDrawing extension; generic data model extensions/recalculation missing. |

No owning attributes.

## Point list

`CT_PtList`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `pt` | Partial point identity/type/source graph; data/presentation kept distinct. |

No owning attributes.

## Connection list

`CT_CxnList`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `cxn` | Partial connection identity/endpoints/order and source XML; parent graph restrictions remain. |

No owning attributes.

## Point

`CT_Pt`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `prSet` | Partial source properties/variables/presentation lookup; custom layout attributes restrict recalculation. Full property set needs nested audit. |
| `spPr` | Partial point/presentation properties merged into generated shapes; custom xfrm/prstGeom/custGeom on point rejects recalculation. |
| `t` | Recalculation and cached-drawing adapter currently require no visible ink; visible/decorated text and diagram text algorithms missing. |
| `extLst` | No generic point extension consumer established. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@modelId` | required | Nonempty unique model identity used by graph; full schema identity lexical/context validation remains open. |
| `@type` | optional | Supported doc/node/asst/parTrans/sibTrans/pres kinds, absent node; graph/presentation semantics bounded. |
| `@cxnId` | optional | Transition points resolve matching parent connection; full transition semantics bounded. |

## Connection

`CT_Cxn`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `extLst` | No generic connection extension consumer established. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@modelId` | required | Nonempty unique connection identity, distinct from point identities; full lexical validation remains open. |
| `@type` | optional | Supported connection kinds and absent parOf; only bounded parent/presentation graph semantics. |
| `@srcId` | required | Required endpoint resolved to point; parent source type restrictions remain. |
| `@destId` | required | Required endpoint resolved to point; bounded parent type/uniqueness restrictions. |
| `@srcOrd` | required | Schema required; reader defaults absent to zero and validates supplied unsigned ordinal. Native-informed ordering subset, not full schema validation. |
| `@destOrd` | required | Schema required; reader defaults absent to zero and validates supplied unsigned ordinal. Full destination-order semantics remain bounded. |
| `@parTransId` | optional | Optional transition identity validated against parent transition and connection; full transition geometry missing. |
| `@sibTransId` | optional | Optional transition identity validated against sibling transition and connection; full transition geometry missing. |
| `@presId` | optional | Source metadata retained; full presentation connection identity/context semantics require further audit. |

## Layout definition

`CT_DiagramDefinition`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `title` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `desc` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `catLst` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `sampData` | Retained sample/definition data; no complete generator/editor consumer established in the current layout path. |
| `styleData` | Retained sample/definition data; no complete generator/editor consumer established in the current layout path. |
| `clrData` | Retained sample/definition data; no complete generator/editor consumer established in the current layout path. |
| `layoutNode` | Partial layout tree expansion and flat linear geometry; full algorithms/constraints/rules/shape/text semantics missing. |
| `extLst` | No general definition-extension semantics; retained source does not establish layout/style extension support. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@uniqueId` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |
| `@minVer` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |
| `@defStyle` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |

## Quick style definition

`CT_StyleDefinition`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `title` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `desc` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `catLst` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `scene3d` | Recalculation permits one neutral scene configuration; active scene styling rejects. |
| `styleLbl` | Partial named style lookup/presentation merge; unresolved or ambiguous presentation formatting rejects. |
| `extLst` | No general definition-extension semantics; retained source does not establish layout/style extension support. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@uniqueId` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |
| `@minVer` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |

## Color definition

`CT_ColorTransform`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `title` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `desc` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `catLst` | Retained descriptive/catalog metadata; no authoring/catalog selection consumer established. Metadata omission is not by itself a rendering defect. |
| `styleLbl` | Partial named color list selection with repeat distribution for fill/line/effect references; text-color lists and other distribution methods restrict support. |
| `extLst` | No general definition-extension semantics; retained source does not establish layout/style extension support. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@uniqueId` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |
| `@minVer` | optional | Retained definition identity/version/default metadata; no complete compatibility/catalog/default-selection consumer established. |

## Remaining work and cache boundary

- Complete diagram text algorithms, visible/decorated content, font fitting and
  custom point layout/geometry. Both current recalculation and cache adapter guard
  visible diagram text; a saved drawing is not a universal visual fallback.
- Extend flat linear geometry to all applicable algorithms, topology, constraints,
  variables, rules, adjustments, ordering and presentation connections. Current
  linear root supports fromL/fromR with bounded leaf tx/sp children; this is not
  general hierarchy/cycle/radial/connector layout.
- Complete background/whole-diagram properties, point properties, active 3D/text
  styles and color distribution methods. Current style resolver supports repeat
  fill/line/effect lists, not every color method or text appearance.
- Complete model ID/required attribute lexical validation and graph/context rules.
  Reader defaults for schema-required srcOrd/destOrd need focused native controls;
  existing ordering behavior is not proof that every absent declaration is valid.
- Extend saved drawing fallback for visible text, diagram-local picture relationships,
  nested models and supported content. Current adapter rejects diagram-local blip
  fills, validates model IDs and bounds group depth to 12. Cache presence does not
  certify source model consistency or safely editable diagram data.
- Inventory layout nodes/algorithms, variable/property sets, style labels and
  nested colors/extension models independently. In particular CT_Colors reaches
  an imported DrawingML color-choice group that the local-schema tool cannot
  resolve; it is outside this named root inventory, not silently omitted coverage.
- Preserve source data/layout/style/color and related drawing parts while rendering
  supported surroundings. Recalculated presentation must use generic model rules;
  source caches should not be substituted for a full data editor or discarded.

Both variants' nine inventories are checked (18 type/variant checks) for named
children and owning attribute names/use. Child CLI checks use
[audit-section-schema.py](../tools/audit-section-schema.py) with `--direct-only`,
`--type`, this ledger and its corresponding `--ledger-section` title.

Existing controls include [diagram-data-model.test.js](../tests/diagram-data-model.test.js),
[diagram-layout-tree.test.js](../tests/diagram-layout-tree.test.js),
[diagram-linear-geometry.test.js](../tests/diagram-linear-geometry.test.js),
[diagram-styling.test.js](../tests/diagram-styling.test.js),
[diagram-recalculation.test.js](../tests/diagram-recalculation.test.js) and
[diagram-drawings.test.js](../tests/diagram-drawings.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
