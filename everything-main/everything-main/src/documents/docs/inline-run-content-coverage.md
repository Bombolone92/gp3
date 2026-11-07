# Inline run-content coverage

Reviewed 2026-10-09 against code baseline `f3ff8e2c` and supplied ECMA-376
Part 1 §17.3.3/§17.3.2 and Part 4 Transitional schemas. This inventories named
run child declarations plus selected primitive/object types and their owning
attributes. It contributes to A01, not full nested DrawingML/VML, content-model,
story or editing support. Strict inventory does not establish Strict import.

Evidence: [docx.js](../src/engine/docx.js),
[docx-xml.js](../src/engine/docx-xml.js), [layout.js](../src/engine/layout.js),
[positional-tabs.js](../src/engine/positional-tabs.js),
[body-symbols.js](../src/engine/body-symbols.js),
[run-property ledger](run-property-coverage.md),
[field ledger](field-code-coverage.md), [note ledger](note-property-coverage.md)
and [comment/revision ledger](comment-revision-property-coverage.md).

There are 33 named direct run declarations in Strict and 34 in Transitional;
`pict` is the additional Transitional declaration. An unsupported run item can
project available visible text in read-only preview while keeping supported
siblings; that does not implement its semantics or enable safe editing.

## Run children

`CT_R`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `rPr` | Run properties handled by their separate ledger; formatting support does not imply all run content is supported. |
| `br` | Partial line/page/column breaks with text-wrapping clear metadata and supported wrap-flow clearance. Cell/page-story/drawing contexts and interactions have restrictions; full layout fidelity remains open. |
| `t` | Text read with element-local xml:space handling; new export requests preserve. Embedded CR/LF text rejects rather than substituting explicit break elements. |
| `contentPart` | No dedicated related run-content reader; resolve and render appropriate referenced content while preserving relationships. |
| `delText` | Read as text only in a deletion revision; unsupported outside that context. Tracked content coverage is separate. |
| `instrText` | Consumed by supported field envelopes; not ordinary visible text. Nested instruction grammar remains missing. |
| `delInstrText` | No dedicated run reader; deleted instruction semantics remain missing. |
| `noBreakHyphen` | Semantic U+2011 model text with separate glyph identity, wrapping and export element preservation; malformed nonempty forms reject. |
| `softHyphen` | Discretionary-hyphen model text, wrapping and export element preservation; full language/automatic hyphenation is a separate gap. |
| `dayShort` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `monthShort` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `yearShort` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `dayLong` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `monthLong` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `yearLong` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `annotationRef` | No general body run consumer; comment projection skips annotationRef and footnote layout uses its own fixed rule. Implement applicable story-specific marker/separator presentation. |
| `footnoteRef` | Supported mark in footnote story; orphan body mark has ordinal-one compatibility display. Context and note format/placement limits remain. |
| `endnoteRef` | Orphan body mark uses ordinal-one compatibility display; not full endnote story support. |
| `separator` | No general body run consumer; comment projection skips annotationRef and footnote layout uses its own fixed rule. Implement applicable story-specific marker/separator presentation. |
| `continuationSeparator` | No general body run consumer; comment projection skips annotationRef and footnote layout uses its own fixed rule. Implement applicable story-specific marker/separator presentation. |
| `sym` | Partial atomic symbol with independent font metadata and retained four-hex-digit character code. Reader requires font/char despite their schema optionality; character validation and missing-font behavior need full controls. |
| `pgNum` | No dedicated editable run reader; implement legacy dynamic date/page content and its contextual display/export semantics. |
| `cr` | Manual line break represented in model; export may use br rather than original element identity. Complete contextual equivalence needs controls. |
| `tab` | Model tab and supported tab stops/leaders; full paragraph/tab interaction coverage remains open. |
| `object` | No dedicated editable run-object reader; embedded/linked objects, controls and their fallback presentation remain missing. |
| `fldChar` | Supported field envelope delimiters with restrictions; complete nested instructions, grammar, form-field metadata and contexts remain open. |
| `ruby` | No dedicated ruby reader/layout/editor; base and annotation content, alignment and typography semantics remain missing. |
| `footnoteReference` | Partial body note reference and supported footnotes; custom-mark and story-context restrictions remain. See note ledger. |
| `endnoteReference` | No full endnote story/reference implementation; dedicated endnote layout/editing remains missing. |
| `commentReference` | Partial known-comment association and point fallback in body; other story contexts unsupported. See comment/revision ledger. |
| `drawing` | Partial supported DrawingML payloads/placement and retained drawings. Full imported picture/shape/chart/effect payload semantics require further audit. |
| `ptab` | Partial explicit alignment/relativeTo/leader parser and native-informed target geometry; full interaction/context coverage remains open. |
| `lastRenderedPageBreak` | Ignored cached pagination hint; current layout repaginates. Do not treat it as an authored forced page break. |
| `pict` | Transitional-only legacy picture container; no dedicated editable run reader. VML payload/preview and preservation need separate work. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@rsidRPr` | optional | Revision session metadata is not in the run model; retained surrounding XML may preserve it. No authoring/revision-session consumer. |
| `@rsidDel` | optional | Revision session metadata is not in the run model; retained surrounding XML may preserve it. No authoring/revision-session consumer. |
| `@rsidR` | optional | Revision session metadata is not in the run model; retained surrounding XML may preserve it. No authoring/revision-session consumer. |

## Text attributes

`CT_Text`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@space` | optional | Imported xml:space reference; preserve keeps edge whitespace, otherwise element-local stripping follows existing native controls. Full lexical/namespace validation remains open. |

## Break attributes

`CT_Br`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@type` | optional | Absent defaults to textWrapping; supported page/column/textWrapping model break kinds. |
| `@clear` | optional | Supported textWrapping none/left/right/all metadata; clear on other break kinds is not interpreted as clearance. Full validity/default/context checks remain open. |

## Positional tab attributes

`CT_PTab`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@alignment` | required | Required and validated against the supported enum; metadata feeds target placement/leaders and is written back. |
| `@relativeTo` | required | Required and validated against the supported enum; metadata feeds target placement/leaders and is written back. |
| `@leader` | required | Required and validated against the supported enum; metadata feeds target placement/leaders and is written back. |

## Symbol attributes

`CT_Sym`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@font` | optional | Optional in schema but required by current reader; own font and code stored for atomic glyph paint/export. Audit absent attributes against native behavior before choosing fallback. |
| `@char` | optional | Optional in schema but required by current reader; own font and code stored for atomic glyph paint/export. Audit absent attributes against native behavior before choosing fallback. |

## Empty run items

`CT_Empty`. No named direct child declarations.

No owning attributes.

## Embedded object container

`CT_Object`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `drawing` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |
| `control` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |
| `objectLink` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |
| `objectEmbed` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |
| `movie` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@dxaOrig` | optional | No dedicated object sizing consumer; implementing original dimensions and fallback presentation remains open. |
| `@dyaOrig` | optional | No dedicated object sizing consumer; implementing original dimensions and fallback presentation remains open. |

## Control attributes

`CT_Control`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@name` | optional | No active control model/preview consumer; keep source/relationship metadata opaque pending presentation support. |
| `@shapeid` | optional | No active control model/preview consumer; keep source/relationship metadata opaque pending presentation support. |
| `@id` | optional | No active control model/preview consumer; keep source/relationship metadata opaque pending presentation support. |

## Relationship reference

`CT_Rel`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Imported relationship-id reference; relevant container has no contentPart/object/movie consumer. Resolve per context, not merely by accepting an id. |

## Legacy picture container

`CT_Picture`. Transitional only. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `movie` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |
| `control` | No dedicated editable containing-object/picture reader; implement this payload and safe fallback presentation separately. |

No owning attributes.

## Boundaries and feature work

- Implement ruby as base/annotation typography, not flattened text. Implement
  legacy date/page content in appropriate story contexts. Keep fields, note marks,
  annotation markers and cached pagination hints distinct from ordinary text.
- Implement embedded/link/control/movie presentation and preservation through
  applicable relationship and content models. Text projection may contain no
  visible fallback for these objects. These named child inventories omit schema
  wildcards: Transitional object/picture containers also allow VML/vendor payloads.
  Cross-schema wildcard contents and their media/resources remain unaudited.
- Complete selected primitive attributes' lexical validation, defaults, namespaces
  and contexts. Required symbol font/char is a reader restriction even though
  both supplied schemas mark these attributes optional; native behavior for
  missing values needs authored controls before selecting a rendering fallback.
- Verify break, clearing, tab, symbol and hyphen interactions with tables, columns,
  floating content, drawing text, page stories, revisions and editing. Existing
  focused controls establish subsets, not every combination or template's fidelity.
- Audit the remaining child types separately: ruby properties/base/annotation,
  drawing payloads, field/form delimiters and related content. `CT_Empty` means
  no content/attributes in that type; it does not define every item's semantics.
- Preserve supported siblings and original source when a run item is unsupported.
  Explicit known-reader failures can differ from unknown-child projection; verify
  local recovery at the appropriate boundary rather than flattening whole stories.

## Inventory validation and existing controls

The nine common types have 18 type/variant checks; Transitional `CT_Picture`
adds one. Direct names and owning attribute names/use are verified independently.
For Strict run children, exclude the separately marked `pict` row when comparing
its schema. The inventory tool does not model simple text content, parent choice
occurrences, imported attribute semantics or wildcard declarations.

Existing controls include [clearing-breaks.test.js](../tests/clearing-breaks.test.js),
[positional-tabs.test.js](../tests/positional-tabs.test.js),
[body-symbols.test.js](../tests/body-symbols.test.js),
[nonbreaking-hyphen.test.js](../tests/nonbreaking-hyphen.test.js),
[soft-hyphens.test.js](../tests/soft-hyphens.test.js) and
[column-breaks.test.js](../tests/column-breaks.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
