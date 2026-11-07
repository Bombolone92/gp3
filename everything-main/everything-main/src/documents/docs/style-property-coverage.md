# Named style and default property coverage

Reviewed 2026-10-09 against baseline `88cc2bf1`, using the supplied ECMA-376
Part 1 §17.7 schemas. This contributes to roadmap A01, not completion of the
exhaustive audit. Strict and Transitional inventories contain three styles-root
children, 22 named-style children, two default-category children and one latent
style exception child. Exception records have attributes but no children.

The current importer expects Transitional WML. Inventorying Strict declarations
does not establish Strict-package import support. Nested attributes, extensions,
property applicability, default precedence and combined contexts remain open.
Untouched style parts survive supported edits; targeted edits patch declarations
in the original XML. Generated styles write the supported subset. Preservation
does not mean retained metadata affects layout, editing or the style gallery.

Evidence: `readStyles`/`writeStyles` in [docx.js](../src/engine/docx.js), resolution
and authoring checks in [styles.js](../src/engine/styles.js), style choice/editing
in [model.js](../src/engine/model.js), [style-editor.js](../src/views/style-editor.js)
and [editor.js](../src/views/editor.js), table-specific handling in
[docx-tables.js](../src/engine/docx-tables.js). Existing controls below identify
relevant behavior; they were not rerun for this documentation-only audit.

## Styles root

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `docDefaults` | Partial: paragraph and run default categories feed resolution. Absent and present-but-empty categories differ. | Complete nested default property/precedence coverage; categories below. |
| `latentStyles` | Retained without a model or gallery consumer. | Implement latent built-in style behavior and metadata defaults/exceptions below. |
| `style` | Partial: identities, name, basedOn, next, paragraph/run and table-specific formatting. | Complete metadata, linking, contexts and authoring below. |

CT_Styles has no own attributes in these schemas.

## Named styles

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `name` | Partial: displayed name, fallback to ID; supported rename patches XML. | Broader locale/built-in name semantics; [style-names.test.js](../tests/style-names.test.js). |
| `aliases` | Retained, no alias resolution or UI consumer. | Name/alias selection, lookup and authoring. |
| `basedOn` | Partial: same-type chain resolution, cycle/error guards and supported edits. | Missing/wrong-type base semantics and every style context; [style-cycle-recovery.test.js](../tests/style-cycle-recovery.test.js). |
| `next` | Partial: read, editable, applied when splitting at paragraph end if target is a paragraph style. | Combined list/table/story and missing-target controls; model.insertParagraph path. |
| `link` | Retained, no linked paragraph/character style activation. | Linked-style selection/application, reciprocal associations and safe authoring. |
| `autoRedefine` | Retained, no automatic style update behavior. | Define automatic redefinition and direct-formatting interactions with undo and preservation. |
| `hidden` | Retained, no gallery filtering consumer. | Hidden-style listing/application and authoring. Not run vanish. |
| `uiPriority` | Retained, no gallery ordering consumer. | Priority and stable ordering, including built-in/latent styles. |
| `semiHidden` | Retained, no gallery filtering consumer. | Visibility policy and interaction with unhideWhenUsed. |
| `unhideWhenUsed` | Retained, no use-driven visibility consumer. | Reveal-on-use behavior, persistence and undo. |
| `qFormat` | Retained; generated basic styles may contain it, but reader/gallery do not use it. | Quick-style gallery membership and authoring. |
| `locked` | Retained; no individual style lock in the style model. | Audit enforcement with formatting protection and latent defaults. Global document protection is a separate path. |
| `personal` | Retained, no consumer. | Personal style metadata interoperability; do not treat this as printed formatting. |
| `personalCompose` | Retained, no consumer. | Compose-style metadata interoperability and applicability. |
| `personalReply` | Retained, no consumer. | Reply-style metadata interoperability and applicability. |
| `rsid` | Retained revision-session metadata, no consumer. | Provenance/revision metadata handling; not tracked-change acceptance/rejection. |
| `pPr` | Partial: supported paragraph properties and numbering references; character definitions do not consume pPr. | Context-specific property coverage and authoring; [style-paragraph-recovery.test.js](../tests/style-paragraph-recovery.test.js), [paragraph-property-coverage.md](paragraph-property-coverage.md). |
| `rPr` | Partial: supported run properties with style-specific toggle resolution and inheritance. | Complete property coverage; highlight rejected in named styles, effects/CS authoring bounded. [style-run-recovery.test.js](../tests/style-run-recovery.test.js), [run-property-coverage.md](run-property-coverage.md). |
| `tblPr` | Partial: table reader resolves table-style chains and supported table formatting. | General named-style editor does not author all table properties; [table-property-coverage.md](table-property-coverage.md). |
| `trPr` | Partial: table-style row defaults through table reader. | Some properties accepted on direct rows reject in style context, including omitted grid columns; verify context-specific applicability. |
| `tcPr` | Partial: table-style cell defaults through table reader. | Style gridSpan, vMerge and hideMark reject; full context coverage and authoring remain open. |
| `tblStylePr` | Partial: twelve named conditional regions; paragraph/run and bounded table/row/cell groups. wholeTable is skipped in the existing native-compatible path. | Full conditional property/context coverage and authoring; [table-style-regions.test.js](../tests/table-style-regions.test.js), [canvas-conditional-table-styles.test.js](../tests/canvas-conditional-table-styles.test.js). |

### Named style attributes

| Attribute | Current behavior | Remaining work |
| --- | --- | --- |
| `@type` | Read, default paragraph; resolution checks expected style type. | Full type/applicability combinations, including numbering styles and linked styles. |
| `@styleId` | Read identity; missing/duplicates guarded. References survive supported edits. | Cross-document remapping and every referring context; [style-identity-recovery.test.js](../tests/style-identity-recovery.test.js). |
| `@default` | Recognizes enabled paragraph, character and table defaults. | Multiple defaults/ambiguity and complete consumer precedence controls. |
| `@customStyle` | Generated styles use enabled value; table reader uses it when recognizing Normal Table defaults. Not general gallery metadata. | Built-in/custom style UI and full lifecycle interoperability. |

Paragraph/character choice lists currently enumerate definitions by type and
report errors; they do not consume visibility, priority or quick-style metadata.
Editing a named style is restricted while the model contains grouped drawings.
Imported paragraph/table and character toggle behavior differs in the native
compatibility subset; see [canvas-style-toggles.test.js](../tests/canvas-style-toggles.test.js).
This ledger does not introduce a new native divergence claim.

Conditional table formatting accepts only tblCellMar/tblBorders/shd in tblPr,
tblHeader in trPr, and tcMar/tcBorders/shd/vAlign/noWrap/textDirection in tcPr.
Even there, conditional textDirection is parsed but omitted from the effective
cell group; table-wide cell direction follows a different path. Root property
acceptance therefore cannot certify conditional-region behavior.

## Document defaults

| Property | Current behavior | Remaining work / evidence |
| --- | --- | --- |
| `rPrDefault` | Partial: run defaults with category presence controlling application kerning/ligature defaults. | Complete nested properties and native default combinations; existing default-kerning controls and run-property ledger. |
| `pPrDefault` | Partial: paragraph properties/reference; absent category invokes application spacing defaults, explicit empty category differs. | Complete nested properties/context precedence; [canvas-style-line-spacing.test.js](../tests/canvas-style-line-spacing.test.js). |

CT_DocDefaults has no own attributes. Defaults use property readers and recovery
paths; acceptance of the category does not implement every property inside it.
The imported application defaults and new-editor authored defaults are distinct.

## Latent styles

| Property | Current behavior | Remaining work |
| --- | --- | --- |
| `lsdException` | Retained; exception records are not resolved into the style model. | Apply metadata overrides by built-in style name and implement interactions below. |

### Latent style attributes

| Attribute | Current behavior | Remaining work |
| --- | --- | --- |
| `@defLockedState` | Retained, no consumer. | Default lock behavior with formatting protection. |
| `@defUIPriority` | Retained, no consumer. | Default gallery ordering. |
| `@defSemiHidden` | Retained, no consumer. | Default gallery visibility. |
| `@defUnhideWhenUsed` | Retained, no consumer. | Default reveal-on-use behavior. |
| `@defQFormat` | Retained, no consumer. | Default quick-style membership. |
| `@count` | Retained, no consumer. | Validate count/applicability and metadata interoperability. |

## Latent exceptions

CT_LsdException has no direct children.

### Exception attributes

| Attribute | Current behavior | Remaining work |
| --- | --- | --- |
| `@name` | Retained, no exception lookup. | Built-in style name identity and locale controls. |
| `@locked` | Retained, no consumer. | Override latent default lock under formatting protection. |
| `@uiPriority` | Retained, no consumer. | Override default ordering. |
| `@semiHidden` | Retained, no consumer. | Override default visibility. |
| `@unhideWhenUsed` | Retained, no consumer. | Override default reveal-on-use. |
| `@qFormat` | Retained, no consumer. | Override default quick-style membership. |

## Verification and next work

Check CT_Styles, CT_Style, CT_DocDefaults, CT_LatentStyles and CT_LsdException
against each supplied schema using [audit-section-schema.py](../tools/audit-section-schema.py)
and the matching section titles. Attribute tables use an @ prefix so they are
not counted as child declarations. Independently compare their names to owning
schema attributes. Schema hashes are recorded in [numbering-property-coverage.md](numbering-property-coverage.md).

All ten type/variant checks matched direct child and own-attribute row sets,
without missing, extra or duplicate names. All relative evidence links resolved.
This validates the inventory boundary, not runtime semantics or native layout.

Prioritize linked styles, metadata-aware style choices and context-specific
formatting controls. Style locks require combined protection controls. Retained
personal/revision/template metadata should be tracked separately from visible
rendering failures. No additional document is certified complete by this audit.
