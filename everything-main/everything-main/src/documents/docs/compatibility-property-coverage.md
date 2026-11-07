# Document compatibility property coverage

Reviewed 2026-10-09 against Documents baseline `f1f9a270` (latest main merged;
incoming changes confined to Whiteboard). Supplied ECMA-376 Part 1 §17.15.3
and Part 4 compatibility schemas declare eight Strict CT_Compat children.
Transitional adds 58, for 66 total. CT_Compat has no own attributes.
The current package importer expects Transitional WML; Strict enumeration
does not demonstrate Strict-package support.

This is the compatibility portion of roadmap A01. CT_Settings itself has
96 Strict / 98 Transitional child declarations, now mapped in the separate
[settings-root ledger](settings-property-coverage.md). Nested semantics remain
open. Compatibility flags, named compatibility settings, consumer defaults and
compatibility-mode branches must not be conflated. Retention of settings XML
does not prove behavior; a missing explicit flag consumer does not prove every
document using that declaration differs visually.

Evidence: readSettings/readPageSettings in [docx.js](../src/engine/docx.js),
[page-settings.js](../src/engine/page-settings.js),
[line-builder.js](../src/engine/line-builder.js),
[layout.js](../src/engine/layout.js), [pagination.js](../src/engine/pagination.js),
[model.js](../src/engine/model.js) and [ligatures.js](../src/engine/ligatures.js).
Unknown compatibility children are not checked by a comprehensive whitelist.
The four explicitly unsupported active flags are handled individually; preview
can retain page geometry and disclose omissions. It is not equivalent to
implementing those switches.

## Shared compatibility declarations

| Property | Current behavior / remaining work |
| --- | --- |
| `spaceForUL` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `balanceSingleByteDoubleByteWidth` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotLeaveBackslashAlone` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `ulTrailSpace` | Partial: trailing-space underline/width handling in line-builder.js. Combined tabs, bidi and decoration require controls. |
| `doNotExpandShiftReturn` | Partial: skips justification expansion at manual line breaks in layout.js. Full script/table/story combinations remain open. |
| `adjustLineHeightInTable` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `applyBreakingRules` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `compatSetting` | Partial: compatibilityMode and enableOpenTypeFeatures name/URI pairs consumed. Other named settings retained without generic dispatch; see attributes below. |

## Transitional additions

| Property | Current behavior / remaining work |
| --- | --- |
| `useSingleBorderforContiguousCells` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `wpJustification` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `noTabHangInd` | Partial: changes implicit hanging-indent tab behavior in line-builder.js. Complete list/style/tab interactions remain open. |
| `noLeading` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `noColumnBalance` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `noExtraLineSpacing` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `spacingInWholePoints` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `lineWrapLikeWord6` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `printBodyTextBeforeHeader` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `printColBlack` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `wpSpaceWidth` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `showBreaksInFrames` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `subFontBySize` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `suppressBottomSpacing` | Unsupported active page-edge spacing: strict rejects; preview omits this behavior with an issue. False is validated and retained. |
| `suppressTopSpacing` | Unsupported active page-edge spacing: strict rejects; preview omits this behavior with an issue. False is validated and retained. |
| `suppressSpacingAtTopOfPage` | Unsupported active page-edge spacing: strict rejects; preview omits this behavior with an issue. False is validated and retained. |
| `suppressTopSpacingWP` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `suppressSpBfAfterPgBrk` | Partial: leading page-break spacing behavior in pagination.js. Complete pagination/section boundary combinations remain open. |
| `swapBordersFacingPages` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `convMailMergeEsc` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `truncateFontHeightsLikeWP6` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `mwSmallCaps` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `usePrinterMetrics` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotSuppressParagraphBorders` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `wrapTrailSpaces` | Partial: trailing/repeated-space wrapping and line width handling in line-builder.js. Mixed-script boundary controls remain open. |
| `footnoteLayoutLikeWW8` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `shapeLayoutLikeWW8` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `alignTablesRowByRow` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `forgetLastTabAlignment` | Partial: terminal non-left tab width handling in line-builder.js. Full alignment/leader combinations need controls. |
| `autoSpaceLikeWord95` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `noSpaceRaiseLower` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotUseHTMLParagraphAutoSpacing` | Partial: automatic paragraph-spacing behavior in layout.js/model.js. Complete consumer-default and context behavior remains open. |
| `layoutRawTableWidth` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `layoutTableRowsApart` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `useWord97LineBreakRules` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotBreakWrappedTables` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotSnapToGridInCell` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `selectFldWithFirstOrLastChar` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotWrapTextWithPunct` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotUseEastAsianBreakRules` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `useWord2002TableStyleRules` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `growAutofit` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `useFELayout` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `useNormalStyleForList` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotUseIndentAsNumberingTabStop` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `useAltKinsokuLineBreakRules` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `allowSpaceOfSameStyleInTable` | Partial: disables contextual-spacing suppression in table cells in layout.js. Combined defaults/style inheritance remain open. |
| `doNotSuppressIndentation` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotAutofitConstrainedTables` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `autofitToFirstFixedWidthCell` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `underlineTabInNumList` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `displayHangulFixedWidth` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `splitPgBreakAndParaMark` | Partial: terminal page-break paragraph mark layout in layout.js. Combined empty paragraphs, lists and story boundaries need controls. |
| `doNotVertAlignCellWithSp` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotBreakConstrainedForcedTable` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `doNotVertAlignInTxbx` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |
| `useAnsiKerningPairs` | Unsupported active behavior: strict import rejects; preview records omission while retaining other page geometry. False is validated and retained. |
| `cachedColBalance` | Retained; no explicit flag consumer found. Author a control for this switch and its interactions before claiming its requested behavior or absence causes a rendering defect. |

## Named compatibility settings

CT_CompatSetting has no direct children and three owning attributes in both
schemas. The importer identifies selected name/URI combinations rather than
implementing every record.

| Attribute | Current behavior / remaining work |
| --- | --- |
| `@name` | compatibilityMode and enableOpenTypeFeatures recognized; other names retained. Complete known setting names and custom-name applicability audit remains open. |
| `@uri` | Both recognized settings require http://schemas.microsoft.com/office/word. Other URIs retained without dispatch. |
| `@val` | compatibilityMode accepts numeric 11/12/14/15, default 12; duplicate matching mode rejects. OpenType switch validates supported on/off spellings; mode 15 defaults on in the existing native-compatible path. Other values retained without implementing semantics. |

See [ligatures.js](../src/engine/ligatures.js) for the existing documented native
OpenType default divergence. This audit adds no new native divergence claim.
Mode-specific table/drawing/cell behavior already exists; that does not mean
individual switches with related names are implemented.

## Editing, preservation and controls

Imported settings parts are retained. Changing document compatibility flags/mode
through page settings is deliberately rejected by the current model/export path.
New-document serialization emits the supported flag subset. This is not full
compatibility-setting authoring. Other operations (for example tracking changes
and page-story creation) patch selected settings declarations, so cross-operation
preservation needs controls rather than an unconditional byte-identity claim.

Existing controls include [canvas-line-spacing.test.js](../tests/canvas-line-spacing.test.js),
[canvas-kerning.test.js](../tests/canvas-kerning.test.js),
[page-setting-recovery.test.js](../tests/page-setting-recovery.test.js),
[canvas-trailing-spaces.test.js](../tests/canvas-trailing-spaces.test.js),
[leading-break-spacing.test.js](../tests/leading-break-spacing.test.js),
[automatic-spacing.test.js](../tests/automatic-spacing.test.js) and
[canvas-indents-tabs.test.js](../tests/canvas-indents-tabs.test.js).
These identify existing evidence, not tests rerun for this documentation audit.

Nine flag declarations have behavior paths, four active declarations explicitly
reject, and the remaining 52 have no explicit named consumer found by source
inspection/search across src JavaScript. The counts exclude unrelated settings
such as noPunctuationKerning and individual named compatSetting values. Absence
from that search requires behavioral confirmation: defaults, platform shaping or
mode branches can cover some requested behavior.

Prioritize controls for column balancing, printer metrics, legacy table width/
AutoFit/row spacing, line-height/spacing, East Asian breaking and list/tab
interaction switches. Test the four explicit omissions and recovery locally.
Remaining view/selection/conversion metadata requires applicability review before
treating it as visible paginated rendering work. Do not remove safety/resource
bounds or import/edit restrictions merely to make a switch disappear from issues.

## Inventory verification

Use [audit-section-schema.py](../tools/audit-section-schema.py) for CT_Compat,
selecting Shared compatibility declarations for Strict and both property tables
for Transitional. CT_CompatSetting uses Named compatibility settings with no
child rows; compare the @ tables to own attributes. The supplied WML hashes are
recorded in [numbering-property-coverage.md](numbering-property-coverage.md).
Nested attributes, all named setting values and combined mode/context semantics
remain open. No template is certified complete by this audit.

All four type/variant checks matched child and own-attribute row sets without
missing, extra or duplicate declarations. All relative evidence links resolved.
These validate the stated inventory boundary, not runtime/native semantics.
