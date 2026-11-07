# DrawingML picture payload coverage

Reviewed 2026-10-09 against code baseline `b0faca39`, supplied ECMA-376
Part 1 DrawingML schemas (§20.1 and §20.2), and their Transitional variants.
This inventories 11 types' named direct children and owning attributes, not
complete nested effects/geometry/colors, image formats or vendor extensions.
It contributes to A01; the separate placement ledger covers wp:anchor/inline.
Strict inventories do not establish Strict package support.

Evidence: [docx-images.js](../src/engine/docx-images.js),
[images.js](../src/engine/images.js), [picture-tiles.js](../src/engine/picture-tiles.js),
[docx-drawing-metadata.js](../src/engine/docx-drawing-metadata.js),
[docx-drawing-hyperlinks.js](../src/engine/docx-drawing-hyperlinks.js),
[model.js](../src/engine/model.js) and
[placement ledger](drawing-placement-property-coverage.md).
Supported pictures retain shell XML, source relationships and media; their
subset includes crop/flips/rotation, some ordered effects, some shape fills,
metadata and aspect locks. Successful import is not full payload support.

## Picture root

`CT_Picture` in `dml-picture.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `nvPicPr` | Partial required nonvisual metadata reader; see the nested type below. |
| `blipFill` | Partial embedded stretched picture fill; shape-fill context permits additional subsets. |
| `spPr` | Partial transforms, geometry, backing fill, outlines, shadows and 3D. Full shape/effect subtree inventory remains open. |

No owning attributes.

## Picture nonvisual properties

`CT_PictureNonVisual` in `dml-picture.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `cNvPr` | Partial inner metadata identity/name validation and retained inactive hyperlink; app image metadata comes from outer wp:docPr. |
| `cNvPicPr` | Partial locks; other child extensions reject and preference metadata has no explicit resize consumer. |

No owning attributes.

## Image data and effects

`CT_Blip` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `alphaBiLevel` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `alphaCeiling` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `alphaFloor` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `alphaInv` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `alphaMod` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `alphaModFix` | Partial ordered effect implementation with retained XML; effect values, color transforms, media pipelines and compositions have bounded support. |
| `alphaRepl` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `biLevel` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `blur` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `clrChange` | Partial ordered effect implementation with retained XML; effect values, color transforms, media pipelines and compositions have bounded support. |
| `clrRepl` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `duotone` | Partial ordered effect implementation with retained XML; effect values, color transforms, media pipelines and compositions have bounded support. |
| `fillOverlay` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `grayscl` | Partial ordered effect implementation with retained XML; effect values, color transforms, media pipelines and compositions have bounded support. |
| `hsl` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `lum` | Partial ordered effect implementation with retained XML; effect values, color transforms, media pipelines and compositions have bounded support. |
| `tint` | Not accepted by current ordinary picture effect reader; implement ordered effect semantics and interactions before enabling editing. |
| `extLst` | Partial recognized extensions including SVG/local-DPI and metadata paths; unknown or malformed extensions reject. Retained extension metadata is not complete semantic support. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@embed` | optional | Embedded image relationship resolves an internal part, validates media/content type and preserves source bytes. Full media-format support remains bounded. |
| `@link` | optional | Presence rejects ordinary linked pictures; retained fallback/link policy remains missing. |
| `@cstate` | optional | Accepted known compression preference, retained; no recompression-policy consumer. |

## Picture fill

`CT_BlipFillProperties` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `blip` | Partial embedded image relationship/media/effects reader; linked images reject. |
| `srcRect` | Partial signed crop/outset rectangle with retained source and edit/export handling. |
| `tile` | Rejected for ordinary picture payloads; partial tile support for raster shape fills, including alignment/scale/offset/flip. Nonrotating tiles on rotated shapes and tiled vector media reject. |
| `stretch` | Required for ordinary picture payloads; missing/conflicting shape fill modes reject. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@dpi` | optional | Retained; shape-fill path validates unsigned integer. No general explicit DPI consumer identified for ordinary picture layout; dimensions come from declared extents. |
| `@rotWithShape` | optional | Read with absent default true, feeds picture/shape-fill behavior; transformed/3D/tile combinations have restrictions. |

## Stretch destination

`CT_StretchInfoProperties` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `fillRect` | Ordinary picture requires zero destination offsets; shape-fill path reads destination rectangle separately. General destination mapping remains incomplete. |

No owning attributes.

## Relative rectangle

`CT_RelativeRect` in `dml-main.xsd`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@l` | optional | Read signed percentage/percentage-decimal, bounded to integer 0.001% precision and signed 32-bit model range; requires positive remaining width/height. Context distinguishes source crop from destination offset. |
| `@t` | optional | Read signed percentage/percentage-decimal, bounded to integer 0.001% precision and signed 32-bit model range; requires positive remaining width/height. Context distinguishes source crop from destination offset. |
| `@r` | optional | Read signed percentage/percentage-decimal, bounded to integer 0.001% precision and signed 32-bit model range; requires positive remaining width/height. Context distinguishes source crop from destination offset. |
| `@b` | optional | Read signed percentage/percentage-decimal, bounded to integer 0.001% precision and signed 32-bit model range; requires positive remaining width/height. Context distinguishes source crop from destination offset. |

## Nonvisual drawing properties

`CT_NonVisualDrawingProps` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `hlinkClick` | Partial metadata hyperlink parser. Inner picture link retained inactive; outer docPr link used by app. Full action semantics are separately bounded. |
| `hlinkHover` | Not accepted by the nonvisual metadata reader; hover hyperlink behavior remains missing. |
| `extLst` | Only recognized decorative/creation-ID metadata accepted; unknown extensions reject. Full vendor extension inventory remains open. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Required inner picture id validated; original shell retained. Complete duplicate identity and multi-context rules need controls. |
| `@name` | required | Required for inner picture metadata, retained; displayed image name comes from outer docPr. |
| `@descr` | optional | Inner metadata retained; displayed alternative text comes from outer docPr. |
| `@hidden` | optional | Active inner hidden picture rejects; implement applicable visibility semantics. |
| `@title` | optional | Retained inner source; no inner title consumer identified in image model. |

## Nonvisual picture preferences

`CT_NonVisualPictureProperties` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `picLocks` | Partial lock validation and aspect enforcement; most active other locks reject. |
| `extLst` | Not in the ordinary picture nonvisual child whitelist; missing extension support. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@preferRelativeResize` | optional | Retained in shell; no explicit consumer found. Implement preference semantics during applicable resize operations. |

## Picture locks

`CT_PictureLocking` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `extLst` | Lock reader permits no child elements; lock extension support missing. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@noGrp` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noSelect` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noRot` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noChangeAspect` | optional | Read to aspectLocked; model resize rejects a changed aspect ratio. |
| `@noMove` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noResize` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noEditPoints` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noAdjustHandles` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noChangeArrowheads` | optional | Recognized and retained; editor has no arrowhead mutation. |
| `@noChangeShapeType` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |
| `@noCrop` | optional | Active value rejects import; false/off values retained. Implement applicable selection/edit restrictions without treating locks as unsupported picture rendering. |

## Picture transform

`CT_Transform2D` in `dml-main.xsd`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `off` | Ordinary picture reader requires zero origin; nonzero origins reject. Nested/group transform semantics require separate context review. |
| `ext` | Positive inner extents read; rotated ordinary pictures with differing inner/outer dimensions reject. Complete transform/extent interactions remain open. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@rot` | optional | Partial signed angle normalization, painting/edit/export; differing inner/outer extents and complex geometry combinations restrict support. |
| `@flipH` | optional | Partial horizontal flip read/edit/export; complex 3D/custom picture combinations restrict support. |
| `@flipV` | optional | Partial vertical flip read/edit/export; complex 3D/custom picture combinations restrict support. |

## Tile properties

`CT_TileInfoProperties` in `dml-main.xsd`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@tx` | optional | Partial shape-fill tile value/default validation and raster tiling; ordinary picture tile rejected, vector/rotation combinations bounded. |
| `@ty` | optional | Partial shape-fill tile value/default validation and raster tiling; ordinary picture tile rejected, vector/rotation combinations bounded. |
| `@sx` | optional | Partial shape-fill tile value/default validation and raster tiling; ordinary picture tile rejected, vector/rotation combinations bounded. |
| `@sy` | optional | Partial shape-fill tile value/default validation and raster tiling; ordinary picture tile rejected, vector/rotation combinations bounded. |
| `@flip` | optional | Partial shape-fill tile value/default validation and raster tiling; ordinary picture tile rejected, vector/rotation combinations bounded. |
| `@algn` | optional | Partial shape-fill tile value/default validation and raster tiling; ordinary picture tile rejected, vector/rotation combinations bounded. |

## Feature work and inventory limits

- Complete missing blip effect kinds and nested color/value semantics in source
  order. Five effect kinds are explicitly accepted by the ordinary reader;
  supported compositions still depend on media/geometry contexts. Do not replace
  unsupported effects with document-specific pre-rendered artwork.
- Complete ordinary picture tile and destination-rectangle semantics; keep
  shape-fill support distinguished from ordinary payload support. Extend rotated,
  custom and 3D geometry combinations using generic transform/paint behavior.
- Implement picture visibility, applicable non-aspect selection/edit locks and
  resize preferences. Preserve valid pictures for viewing when an edit operation
  is restricted. Current active lock/hidden rejection is not semantic enforcement.
- Complete linked-image/fallback handling and context-aware metadata/hyperlinks.
  Source retention of an inactive inner link is not a universal clickable link;
  external resource evaluation and embedded-source rendering are different paths.
- Audit full shape properties, outline/effect lists, color transforms, nested
  picture/group transforms, theme dependencies, extensions and media decoders.
  This ledger does not enumerate those child types or assert all media formats.
- Validate required/default values, duplicates, order/choice rules, parent context,
  identity and source-preserving edits with focused controls. Direct declaration
  counts alone do not prove a valid DOCX or native rendering fidelity.

Both variants' direct child/attribute inventories are checked for all 11 types
(22 type/variant checks). Use [audit-section-schema.py](../tools/audit-section-schema.py)
with `--direct-only --type TYPE --ledger docs/picture-payload-property-coverage.md
--ledger-section TITLE` to check child rows. Attribute names/use are checked
separately. Supplied schema hashes are recorded in the verification output;
schemas remain outside the repository.

Existing focused controls include
[canvas-image-crops.test.js](../tests/canvas-image-crops.test.js),
[canvas-image-rotation.test.js](../tests/canvas-image-rotation.test.js),
[canvas-picture-alpha.test.js](../tests/canvas-picture-alpha.test.js),
[canvas-picture-duotone.test.js](../tests/canvas-picture-duotone.test.js),
[canvas-picture-color-change.test.js](../tests/canvas-picture-color-change.test.js),
[canvas-picture-luminance.test.js](../tests/canvas-picture-luminance.test.js),
[canvas-picture-grayscale.test.js](../tests/canvas-picture-grayscale.test.js) and
[canvas-picture-tiles.test.js](../tests/canvas-picture-tiles.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
