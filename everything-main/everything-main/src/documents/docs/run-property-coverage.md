# Run property coverage

Reviewed 2026-10-09 against Documents baseline `1d4669f5`. Both supplied Strict
and Transitional `CT_RPr` declarations expose 40 direct property kinds through
their groups. This is a bounded part of roadmap A01, not a complete attribute,
context, extension or native-reference compatibility audit. Relevant clauses are ECMA-376 Part 1
§17.3.2 (run properties), §17.7 (styles) and §17.13.5 (revisions).

Comparing schemas does not mean Strict-namespace packages are supported: the
engine uses the Transitional WML namespace, and Strict import remains a separate
gap. The inventory is not an XML validator and does not model every enclosing
choice/occurrence rule. Some readers reject duplicate declarations even though
`EG_RPrBase` is repeatable in the schema; effective precedence needs substantive
specification and native controls before changing those restrictions.

Source run properties generally remain in retained XML through surrounding text
and supported formatting edits. Clear Formatting intentionally removes opaque
direct declarations while preserving the character style. Retention is neither
unconditional nor proof of painting. The 2010 `w14` effects and older `w`
flags are separate declarations even when their names are similar.

| Property | Import / layout and paint | Editing, preservation and remaining work | Evidence |
| --- | --- | --- | --- |
| `rStyle` | Partial: character style selection, defaults, inheritance and toggles. | Selection/serialization exist; unsupported inherited properties remain unsupported. | [docx.js](../src/engine/docx.js), [styles.js](../src/engine/styles.js) |
| `rFonts` | Partial: four slots, theme resolution, hint, charset metadata and alternatives. | Font-slot edits serialize names and remove overridden theme attributes. Full classification/fallback/native metrics remain open; no font programs were inspected for this audit. | [docx-fonts.js](../src/engine/docx-fonts.js), [font-families.js](../src/engine/font-families.js) |
| `b` | Bounded ordinary bold declaration and style behavior. | Direct/style edits serialize. Complete face matching and duplicate/value validation need separate controls. | [docx.js](../src/engine/docx.js), [styles.js](../src/engine/styles.js), [canvas-text.js](../src/engine/canvas-text.js) |
| `bCs` | Partial: independently resolved complex-script weight. | Bold commands can patch ordinary/CS declarations; activating CS/RTL has model restrictions. | [font-families.js](../src/engine/font-families.js), [model.js](../src/engine/model.js) |
| `i` | Bounded ordinary italic declaration and style behavior. | Direct/style edits serialize; face matching and synthetic rendering need their own native scope. | [docx.js](../src/engine/docx.js), [canvas-text.js](../src/engine/canvas-text.js) |
| `iCs` | Partial: CS italic; RTL display uses its established synthetic-italic rule. | Commands can patch both declarations; activating CS/RTL remains restricted. | [font-families.js](../src/engine/font-families.js), [model.js](../src/engine/model.js) |
| `caps` | Partial: display capitalization with source text retained and style precedence. | Edits serialize supported flags and paired-off compatibility forms; language/script cases remain bounded. | [docx-capitalization.js](../src/engine/docx-capitalization.js), [capitalization.js](../src/engine/capitalization.js) |
| `smallCaps` | Partial: small-cap display, inheritance and conflict/reset behavior. | Edits serialize supported forms; full synthetic/typographic equivalence is unproven. | [capitalization.js](../src/engine/capitalization.js), [canvas-text.js](../src/engine/canvas-text.js) |
| `strike` | Bounded single strike with explicit/style resets. | Supported edits serialize and preserve unrelated XML. | [docx-strikethrough.js](../src/engine/docx-strikethrough.js), [strikethrough.js](../src/engine/strikethrough.js) |
| `dstrike` | Bounded double strike and single/double precedence. | Edits serialize; all script/font/native geometry combinations are unproven. | [strikethrough.js](../src/engine/strikethrough.js), [canvas-paint-text.js](../src/engine/canvas-paint-text.js) |
| `outline` | Missing legacy WML outline-flag consumer. | Implement glyph outline and toggle semantics; existing `w14:textOutline` is distinct. | [text-outline.js](../src/engine/text-outline.js), `runProperties` in [docx.js](../src/engine/docx.js) |
| `shadow` | Missing legacy WML shadow-flag consumer. | Implement legacy geometry/inheritance; `w14:shadow` does not satisfy this flag. | [text-shadow.js](../src/engine/text-shadow.js), [docx.js](../src/engine/docx.js) |
| `emboss` | Missing legacy embossed text behavior. | Add effect/toggle controls and interactions with color and other effects. | `runProperties` in [docx.js](../src/engine/docx.js) |
| `imprint` | Missing legacy imprinted text behavior. | Implement visual semantics and conflicts with emboss/outline/shadow. | `runProperties` in [docx.js](../src/engine/docx.js) |
| `noProof` | Body spelling honors effective exemptions, inherited true and explicit false. Exempt boundaries split proofing while source offsets and paint remain unchanged. | Source-preserving edits/serialization and native mixed-run controls exist. Grammar, other-story proofing and DrawingML's separate attribute remain open. | [control](../tests/fixtures/no-proof/README.md), [proofing.js](../src/views/proofing.js), [docx.js](../src/engine/docx.js) |
| `snapToGrid` | Missing run grid behavior. | Implement with section character pitch and paragraph snapping, preserving source text. | [section ledger](section-property-coverage.md), [paragraph ledger](paragraph-property-coverage.md) |
| `vanish` | Partial: hidden text stays in source/model but has no displayed width; formatting marks can reveal it. | Existing declarations survive edits; `vanish` is not a general `setRunFormat` property, so authoring is incomplete. | [revisions.js](../src/engine/revisions.js), [layout.js](../src/engine/layout.js), [formatting.js](../src/engine/formatting.js) |
| `webHidden` | Parsed/preserved; text stays visible in paged canvas. Web-view hiding is separate and unimplemented. | Visible-text edits/round trips have controls. Paged visibility with this flag on is not automatically a defect. | [web-hidden.test.js](../tests/web-hidden.test.js), [docx.js](../src/engine/docx.js) |
| `color` | Partial: RGB/auto/theme resolution and supported transforms. | Edits serialize; arbitrary color spaces and automatic-color decisions remain bounded. | [docx-colors.js](../src/engine/docx-colors.js), [colors.js](../src/engine/colors.js) |
| `spacing` | Partial: signed character spacing, physical units and inheritance. | Edits serialize; shaping, ligature, justification and script combinations need separate evidence. | [docx-run-spacing.js](../src/engine/docx-run-spacing.js), [character-spacing.js](../src/engine/character-spacing.js) |
| `w` | Partial: horizontal text scaling within supported validation range. | Width edits serialize; all mixed-object/script/decoration effects remain unproven. | [docx-text-scale.js](../src/engine/docx-text-scale.js), [text-scale.js](../src/engine/text-scale.js) |
| `kern` | Partial: threshold/inheritance resolution and bounded font kerning. | Supported edits serialize; native metrics/compatibility variation is distinct. | [docx-kerning.js](../src/engine/docx-kerning.js), [kerning.js](../src/engine/kerning.js) |
| `position` | Partial: signed baseline shift and physical units. | Edits serialize and interact with automatic vertical alignment; restrictions remain. | [docx-vertical-align.js](../src/engine/docx-vertical-align.js), [vertical-align.js](../src/engine/vertical-align.js) |
| `sz` | Partial: numeric half-point size and inherited resolution. | Edits serialize 1–1638pt. This reader uses numeric conversion, not the universal-measure parser used by position/kerning; audit physical-unit size declarations. | [font-size.js](../src/engine/font-size.js), `runProperties` in [docx.js](../src/engine/docx.js) |
| `szCs` | Partial: numeric CS size independently resolves for applicable run display. | Commands can update both sizes; active CS editing and physical-unit declarations remain separate gaps. | [font-families.js](../src/engine/font-families.js), [docx.js](../src/engine/docx.js), [model.js](../src/engine/model.js) |
| `highlight` | Partial: direct supported values; active defaults/named-style/numbering highlight is explicitly restricted to the recorded native-reference subset. | Direct edits serialize; context compatibility and other values need controls. | [docx-backgrounds.js](../src/engine/docx-backgrounds.js), [backgrounds.js](../src/engine/backgrounds.js) |
| `u` | Partial: supported underline styles/colors, word behavior and inheritance. | Edits serialize; unavailable styles/metric combinations remain open. | [docx-underlines.js](../src/engine/docx-underlines.js), [underlines.js](../src/engine/underlines.js), [canvas-underlines.js](../src/engine/canvas-underlines.js) |
| `effect` | Missing legacy text-animation consumer. | Define screen, reduced-motion and static-print behavior separately; not a static glyph metric. | `runProperties` in [docx.js](../src/engine/docx.js) |
| `bdr` | Missing run-border consumer; page/paragraph borders are different contexts. | Implement geometry, grouping, color and line-break interactions with edits/controls. | [docx-backgrounds.js](../src/engine/docx-backgrounds.js), [docx.js](../src/engine/docx.js) |
| `shd` | Partial: clear/solid run shading; other patterns reject. | Supported edits serialize; complete pattern/background geometry remains open. | [docx-backgrounds.js](../src/engine/docx-backgrounds.js), [backgrounds.js](../src/engine/backgrounds.js) |
| `fitText` | Unsupported: `readRunSpacing` marks presence and `checkedRunFormat` rejects manual widths. | Implement width/group ID semantics and precedence over spacing. | [docx-run-spacing.js](../src/engine/docx-run-spacing.js), [formatting.js](../src/engine/formatting.js) |
| `vertAlign` | Partial: baseline/subscript/superscript sizing and shifts. | Edits serialize; object, line-rule and script combinations remain bounded. | [vertical-align.js](../src/engine/vertical-align.js), [docx-vertical-align.js](../src/engine/docx-vertical-align.js) |
| `rtl` | Partial: imported RTL selects CS formatting and participates in bidi painting/order/hit testing. Paragraph bidi is restricted. | Imported content is retained through supported edits, but `setRunFormat({rtl:true})` rejects activating it. | [bidi-text.js](../src/engine/bidi-text.js), [bidi-line.js](../src/engine/bidi-line.js), [model.js](../src/engine/model.js) |
| `cs` | Partial: imported CS selects its font, weight, italic and size. | `setRunFormat({cs:true})` rejects activation; declaration retention is not complete authoring. | [font-families.js](../src/engine/font-families.js), [model.js](../src/engine/model.js) |
| `em` | Missing emphasis-mark consumer. | Implement shapes, placement, script/vertical interactions and authoring; bold/italic is distinct. | `runProperties` in [docx.js](../src/engine/docx.js) |
| `lang` | Partial: three language attributes resolved for font/theme/script classification. | Edits serialize metadata; language-specific proofing, hyphenation and shaping remain separate. | [docx-fonts.js](../src/engine/docx-fonts.js), [font-families.js](../src/engine/font-families.js), [proofing.js](../src/views/proofing.js) |
| `eastAsianLayout` | Missing declaration consumer. | Implement combine/group IDs/brackets and vertical/compressed run layout. | `runProperties` in [docx.js](../src/engine/docx.js) |
| `specVanish` | Missing special paragraph-mark hiding behavior. | Implement paragraph/line semantics; ordinary `vanish` cannot substitute. | [layout.js](../src/engine/layout.js), [docx.js](../src/engine/docx.js) |
| `oMath` | Missing WML math-run flag semantics. OMML has a separate retained linear approximation. | Implement math formatting/layout without confusing this flag with `m:oMath`. | [office-math.js](../src/engine/office-math.js), [docx.js](../src/engine/docx.js) |
| `rPrChange` | Previous formatting retained; current formatting displayed and revision listed. | Accept exists; reject does not restore previous formatting. Original-format/nested revision controls remain open. | [revisions.js](../src/engine/revisions.js), `resolveRevisions` in [model.js](../src/engine/model.js) |

## Verification and remaining boundary

Run `python tools/audit-section-schema.py PATH_TO_wml.xsd --type CT_RPr
--ledger docs/run-property-coverage.md` from the app. Both schemas have 40 direct
property kinds and no own `CT_RPr` attributes. Paragraph-mark, numbering-level,
math-control and style contexts, plus `w14` extensions, need their own review.

Schema SHA-256 values: Strict
`44fc2233c5df2cfbe0b3b50e7024bd8412ec99dfe7176313ef58845fdec5498d`;
Transitional `0f7784b36ddc42950e5ff354cd608b83b60e4de39325d5568913f1225365029b`.
The row check catches omissions/duplicates, not renderer defects by itself.

Relevant existing regressions include [capitalization](../tests/canvas-capitalization.test.js),
[strike](../tests/canvas-strikethrough.test.js),
[underline](../tests/canvas-underlines.test.js),
[font slots](../tests/canvas-font-families.test.js),
[CS formatting](../tests/complex-script-formatting.test.js),
[hidden text](../tests/hidden-text.test.js),
[vertical alignment](../tests/canvas-vertical-align.test.js),
[extension outline](../tests/text-outline.test.js), and
[extension shadow](../tests/text-shadow.test.js). The last two cover `w14`, not
legacy flags. This audit adds no visual-fidelity evidence or template-completion
claim. Next controls should target silently retained legacy effects, borders,
emphasis and grid/combination behavior, including default/off declarations.
