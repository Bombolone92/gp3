# DrawingML placement property coverage

Reviewed 2026-10-09 against baseline `cae2fad3`, using supplied ECMA-376
Part 1 §20.4 Wordprocessing DrawingML schemas. This contributes to roadmap A01.
Both variants declare thirteen anchor children, five inline children and the
same position/wrap types audited below. This is direct declaration coverage,
not full DrawingML, image effects, shape geometry, textbox, chart or diagram
support. The runtime expects Transitional drawing namespaces.

Import evidence: [docx-anchors.js](../src/engine/docx-anchors.js) and
[docx-images.js](../src/engine/docx-images.js). Layout/paint evidence:
[positioned-images.js](../src/engine/positioned-images.js),
[square-wrap.js](../src/engine/square-wrap.js),
[drawing-collisions.js](../src/engine/drawing-collisions.js),
[canvas-editor.js](../src/engine/canvas-editor.js). Supported edits patch saved
drawing shells; wrapping conversion rewrites the frame while retaining graphic
content. See [image-wrap.js](../src/engine/image-wrap.js) and
[image-interaction.js](../src/engine/image-interaction.js).
Retention is not implementation. Existing test links identify evidence paths;
this documentation audit does not claim they were rerun or certify templates.

## Floating anchors

CT_Anchor

| Property | Current behavior / remaining work |
| --- | --- |
| `simplePos` | Coordinates validated and retained while attribute is false; active simple positioning rejects. Implement active coordinate semantics. |
| `positionH` | Partial: column offsets; page/margin and alignment availability depends on wrapping. Character, physical side/inside/outside margin bases and inside/outside alignment reject. |
| `positionV` | Partial: paragraph offsets; page/margin/topMargin/bottomMargin/line in bounded no-wrap paths. Inside/outside bases and alignment reject; other combinations restricted. |
| `extent` | Physical EMU size consumed; ordinary images bounded to positive dimensions up to 22 inches. Flat retained drawing cases have separate zero-axis controls. Wider valid sizes are a resource/layout task. |
| `effectExtent` | Partial: nonnegative extra extents feed layout. Signed values reject; rotated/effect-extent pictures with text wrapping reject. Full combinations remain open. |
| `wrapNone` | Partial: positioned front/behind objects, alignment, cell/page bases and bounded overlap avoidance. Floating charts reject. |
| `wrapSquare` | Partial: numeric column/paragraph side wrapping, or standalone full-column centered band. Other coordinate combinations and nested wrap extent reject. |
| `wrapTight` | Unsupported polygon wrapping; anchor/import whitelist rejects. Implement contour exclusions and safe editing. |
| `wrapThrough` | Unsupported polygon wrapping; anchor/import whitelist rejects. Implement through-contour exclusion semantics and editing. |
| `wrapTopAndBottom` | Partial: positioned band wrapping; vertical base and distance restrictions. Nested wrap extent rejects. |
| `docPr` | Partial: ID/name/description plus supported click hyperlink and decorative/creation metadata. Active hidden properties reject; hover links and broader imported metadata need audit. |
| `cNvGraphicFramePr` | Partial: graphicFrameLocks reader. Active locks beyond supported aspect/arrowhead retention reject; extLst and remaining behaviors need controls. |
| `graphic` | Imported a:graphic reference; supports bounded pictures, shapes/groups, diagrams and inline charts. Payload completeness requires separate imported schema audits. Floating charts and charts outside body reject. |

### Anchor attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@distT` | Partial: square anchor/wrap distances; top-and-bottom anchor vertical distances limited to zero. No-wrap values retained without text exclusion. |
| `@distB` | Same vertical distance restrictions as distT; complete band distances remain open. |
| `@distL` | Partial square distance; top-and-bottom/no-wrap accepted within import validation. Full combinations and distance authoring remain open. |
| `@distR` | Same horizontal distance scope as distL. |
| `@simplePos` | Reader requires explicit false/0 even though optional in these schemas; true and absent reject. Verify omitted/default behavior and implement active mode. |
| `@relativeHeight` | Unsigned stacking order consumed; supported arrangement edits serialize it. Native tie/source order and cross-story combinations need broader controls. |
| `@behindDoc` | Supported for positioned objects, including tested wrapped-behind subset. Standalone centered-band branch requires false. Complete combinations remain open. |
| `@locked` | Retained; source anchor is kept without automatic re-anchoring. Not a general movement prohibition or lock authoring command. |
| `@layoutInCell` | False accepted in bounded no-wrap coordinate combinations; text-wrapped paths require true. Complete cell/compatibility interactions remain open. |
| `@hidden` | Absent/false accepted; active hidden rejects. Implement nonvisible object retention/layout semantics. |
| `@allowOverlap` | False accepted for no-wrap objects; text-wrapped paths require true. Collision displacement involving text-wrapped objects remains unsupported. |

## Inline frames

CT_Inline

| Property | Current behavior / remaining work |
| --- | --- |
| `extent` | Consumed inline image/frame metrics; bounded dimensions and retained flat drawing exceptions as above. |
| `effectExtent` | Partial extra extents included in inline metrics; complete signed/effect/rotation behavior still requires controls. |
| `docPr` | Same bounded metadata reader as anchors; description retained as alt text, active hidden rejects. |
| `cNvGraphicFramePr` | Same lock reader as anchors; not full graphic-frame nonvisual semantics. |
| `graphic` | Same payload dispatch as anchors, with inline chart support. Imported payload types are outside this inventory. |

### Inline attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@distT` | Validated and retained without changing inline layout (§20.4.2.8); this is not missing text exclusion. |
| `@distB` | Validated and retained without changing inline layout (§20.4.2.8); this is not missing text exclusion. |
| `@distL` | Validated and retained without changing inline layout (§20.4.2.8); this is not missing text exclusion. |
| `@distR` | Validated and retained without changing inline layout (§20.4.2.8); this is not missing text exclusion. |

## Horizontal position

CT_PosH

| Property | Current behavior / remaining work |
| --- | --- |
| `align` | Left/center/right in bounded no-wrap/band paths; centered standalone square band. Inside/outside unsupported. |
| `posOffset` | Signed EMU offset, bounded to 22 inches; numeric side wrap restricted to column base. Preserve fractional pixel precision. |

### Horizontal position attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@relativeFrom` | Column/page/margin subset depends on wrapping; character and side/inside/outside margin bases unsupported. |

## Vertical position

CT_PosV

| Property | Current behavior / remaining work |
| --- | --- |
| `align` | Top/center/bottom in bounded no-wrap paths; standalone band requires paragraph/top. Inside/outside and paragraph/line alignment combinations unsupported. |
| `posOffset` | Signed bounded offset; paragraph and supported page/margin/line references. Combined cell/section origins require native controls. |

### Vertical position attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@relativeFrom` | Paragraph/page/margin/topMargin/bottomMargin/line subset depends on wrapping. Inside/outside margins unsupported. |

## Square wrap

CT_WrapSquare

| Property | Current behavior / remaining work |
| --- | --- |
| `effectExtent` | Unsupported here: wrap reader rejects children. Top-level frame effect extent is a different declaration. |

### Square wrap attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@wrapText` | bothSides/left/right/largest supported in numeric side-wrap subset. Standalone full-column band remains restricted. |
| `@distT` | Numeric side-wrap override falls back to anchor distance; bounded nonnegative EMU. Standalone band requires zero. |
| `@distB` | Numeric side-wrap override falls back to anchor distance; bounded nonnegative EMU. Standalone band requires zero. |
| `@distL` | Numeric side-wrap override falls back to anchor distance; bounded nonnegative EMU. Standalone band requires zero. |
| `@distR` | Numeric side-wrap override falls back to anchor distance; bounded nonnegative EMU. Standalone band requires zero. |

## Top and bottom wrap

CT_WrapTopBottom

| Property | Current behavior / remaining work |
| --- | --- |
| `effectExtent` | Unsupported here: wrap reader rejects children; distinct from frame effectExtent. |

### Top and bottom attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@distT` | Only zero accepted on wrap element; nonzero band text distances remain unsupported. |
| `@distB` | Only zero accepted on wrap element; nonzero band text distances remain unsupported. |

## Tight wrap

CT_WrapTight

| Property | Current behavior / remaining work |
| --- | --- |
| `wrapPolygon` | Unsupported contour reader/layout. Requires authored polygon and text-exclusion controls. |

### Tight wrap attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@wrapText` | Unsupported with tight wrapping; implement side choice/distance with contour semantics. |
| `@distL` | Unsupported with tight wrapping; implement side choice/distance with contour semantics. |
| `@distR` | Unsupported with tight wrapping; implement side choice/distance with contour semantics. |

## Through wrap

CT_WrapThrough

| Property | Current behavior / remaining work |
| --- | --- |
| `wrapPolygon` | Unsupported through-contour reader/layout. Distinguish holes and usable text regions from tight wrapping. |

### Through wrap attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@wrapText` | Unsupported with through wrapping; implement side choice/distance with contour semantics. |
| `@distL` | Unsupported with through wrapping; implement side choice/distance with contour semantics. |
| `@distR` | Unsupported with through wrapping; implement side choice/distance with contour semantics. |

## Wrap polygon

CT_WrapPath

| Property | Current behavior / remaining work |
| --- | --- |
| `start` | Unsupported initial contour point; imported a:CT_Point2D requires coordinate/geometry audit. |
| `lineTo` | Unsupported polygon edges; occurrence/closure and combined rotation/scale need controls. |

### Polygon attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@edited` | Retained only in unsupported source; implement authored versus generated contour behavior. |

## No wrap

CT_WrapNone has no direct children or own attributes. Supported as a wrapping
mode within the bounded anchor paths above. Source children/attributes reject.

## Effect extent

CT_EffectExtent has no direct children.

### Effect extent attributes

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@l` | Frame reader requires nonnegative integer EMU; signed coordinates declared by schema reject. Complete inset/outset and wrapped-effect behavior remain open. |
| `@t` | Frame reader requires nonnegative integer EMU; signed coordinates declared by schema reject. Complete inset/outset and wrapped-effect behavior remain open. |
| `@r` | Frame reader requires nonnegative integer EMU; signed coordinates declared by schema reject. Complete inset/outset and wrapped-effect behavior remain open. |
| `@b` | Frame reader requires nonnegative integer EMU; signed coordinates declared by schema reject. Complete inset/outset and wrapped-effect behavior remain open. |

## Boundaries, controls and next work

Existing controls include [canvas-inactive-simple-position.test.js](../tests/canvas-inactive-simple-position.test.js),
[anchor-offset-precision.test.js](../tests/anchor-offset-precision.test.js),
[wrapped-behind.test.js](../tests/wrapped-behind.test.js),
[no-wrap-overlap.test.js](../tests/no-wrap-overlap.test.js),
[canvas-mixed-cell-anchors.test.js](../tests/canvas-mixed-cell-anchors.test.js),
[percentage-anchors.test.js](../tests/percentage-anchors.test.js) and
[image-interaction.test.js](../tests/image-interaction.test.js).
Overlap avoidance retains the existing native compatibility rule for touching
edges; see drawing-collisions.js and its controls, not a new divergence claim.

The `wp14` percentage position/relative-size paths exist outside these base
schema declarations. Relative-sized drawings retain wrapping and disable direct
resize in the current interaction path. Other imported drawings resize only when
the drawing editor can safely rewrite them. Movement/layer commands are bounded
to supported positioned objects; not all retained drawings are fully editable.

Prioritize polygon wrapping, missing coordinate bases/alignment, hidden drawings,
active/omitted simple positioning, nested wrap extents and signed frame extents.
Each implementation needs independently authored files, interaction/round-trip
checks and native comparison where behavior differs. Collision, section/column,
cell and story interactions remain broader than any single schema property.

Inventory checks use [audit-section-schema.py](../tools/audit-section-schema.py).
Imported references retain their QName and direct name without resolving imported
types. Imported a:graphic/point/size/nonvisual types need their own audit.
Schema SHA256: Strict `725d64911076b34f1b2d60004cd14866fc0a399ab9808dc09415197a9e4dd144`;
Transitional `2dbfd4719505bf39b568005994a433997cbeac59cebc9d4867d564c94e9ba03a`.

All 22 type/variant checks matched direct child and own-attribute tables without
missing, extra or duplicate entries; all relative links resolved. The schema
checker now records direct imported reference names and retains their QName.
Synthetic element/attribute controls verified this boundary and unnamed-declaration
rejection; all 34 preceding WML type/variant property-count checks stayed unchanged.
These are audit-tool checks, not new renderer or native layout validation.
