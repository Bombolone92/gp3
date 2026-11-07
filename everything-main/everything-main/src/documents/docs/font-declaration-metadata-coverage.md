# Font declaration metadata coverage

Reviewed 2026-10-09 against code baseline `b6fc01b2` and supplied ECMA-376
Part 1 §17.8/§17.3.2.26 and Transitional WML schemas. This inventories nine
metadata types' direct children and owning attributes, not font programs or
complete font selection/rendering fidelity. Strict inventories do not establish
Strict package support.

Evidence: [docx-fonts.js](../src/engine/docx-fonts.js),
[font-families.js](../src/engine/font-families.js),
[theme ledger](theme-structure-coverage.md) and
[run-property ledger](run-property-coverage.md).
Only source code and XML declaration schemas were reviewed. No installed,
embedded or supplied font program was decoded, inspected or registered.

The reader has explicit slot, theme, alternative-name and bounded family
fallback behavior. Metadata retention does not prove native matching, coverage,
metrics, installed-face availability or embedding support/permission.

## Run font slots

`CT_Fonts`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@hint` | optional | Validated default/eastAsia/cs model hint; full glyph/script/context selection remains bounded. |
| `@ascii` | optional | Explicit slot name read/validated unless same-declaration theme slot takes precedence; style hierarchy resolves resulting slot values. Full installed/missing-face matching remains separate. |
| `@hAnsi` | optional | Explicit slot name read/validated unless same-declaration theme slot takes precedence; style hierarchy resolves resulting slot values. Full installed/missing-face matching remains separate. |
| `@eastAsia` | optional | Explicit slot name read/validated unless same-declaration theme slot takes precedence; style hierarchy resolves resulting slot values. Full installed/missing-face matching remains separate. |
| `@cs` | optional | Explicit slot name read/validated unless same-declaration theme slot takes precedence; style hierarchy resolves resulting slot values. Full installed/missing-face matching remains separate. |
| `@asciiTheme` | optional | Theme slot read with same-declaration precedence over explicit face; supported major/minor token and settings-script lookup. Writing an explicit face clears this theme slot; see theme ledger for limits. |
| `@hAnsiTheme` | optional | Theme slot read with same-declaration precedence over explicit face; supported major/minor token and settings-script lookup. Writing an explicit face clears this theme slot; see theme ledger for limits. |
| `@eastAsiaTheme` | optional | Theme slot read with same-declaration precedence over explicit face; supported major/minor token and settings-script lookup. Writing an explicit face clears this theme slot; see theme ledger for limits. |
| `@cstheme` | optional | Theme slot read with same-declaration precedence over explicit face; supported major/minor token and settings-script lookup. Writing an explicit face clears this theme slot; see theme ledger for limits. |

## Font table

`CT_FontsList`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `font` | Partial font-table name/charset/alternative/family lookup; unknown metadata retained in source, not full font substitution. |

No owning attributes.

## Font declaration

`CT_Font`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `altName` | Explicit alternative name used in fallback list with checked names and duplicate-alternative rejection. |
| `panose1` | Retained metadata; no explicit PANOSE matching consumer found. |
| `charset` | Partial Transitional val lookup for EastAsian charset/fallback decisions; characterSet is not read by this path. |
| `family` | Partial Latin missing-face fallback: roman uses Cambria, other recognized families use Calibri for absent/00 charset. Native-informed subset, not full family matching. |
| `notTrueType` | Retained; no explicit face-technology matching consumer found. |
| `pitch` | Retained; no explicit declared pitch matching consumer found. |
| `sig` | Retained; no explicit font-signature coverage selection consumer found. |
| `embedRegular` | Embedding relationship metadata retained in font table. Program decoding/loading/licensing is outside this metadata audit; no program was inspected or registered. |
| `embedBold` | Embedding relationship metadata retained in font table. Program decoding/loading/licensing is outside this metadata audit; no program was inspected or registered. |
| `embedItalic` | Embedding relationship metadata retained in font table. Program decoding/loading/licensing is outside this metadata audit; no program was inspected or registered. |
| `embedBoldItalic` | Embedding relationship metadata retained in font table. Program decoding/loading/licensing is outside this metadata audit; no program was inspected or registered. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@name` | required | Required declaration name keys charset and alternatives; full declaration/default/duplicate-name validation remains open. |

## Embedding reference metadata

`CT_FontRel`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Embedding reference metadata; source retention does not prove relationship/key/subset validity or authorization to decode/load a program. Program semantics are outside this audit. |
| `@fontKey` | optional | Embedding reference metadata; source retention does not prove relationship/key/subset validity or authorization to decode/load a program. Program semantics are outside this audit. |
| `@subsetted` | optional | Embedding reference metadata; source retention does not prove relationship/key/subset validity or authorization to decode/load a program. Program semantics are outside this audit. |

## PANOSE metadata

`CT_Panose`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@val` | required | Required PANOSE metadata retained; no explicit matching consumer found. |

## Family metadata

`CT_FontFamily`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@val` | required | Recognized family values inform the bounded Latin fallback path; complete lexical/default matching remains open. |

## Pitch metadata

`CT_Pitch`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@val` | required | Required pitch metadata retained; no explicit declared-pitch matching consumer found. |

## Coverage signature

`CT_FontSig`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@usb0` | required | Required signature word retained; no explicit coverage-matching consumer found. |
| `@usb1` | required | Required signature word retained; no explicit coverage-matching consumer found. |
| `@usb2` | required | Required signature word retained; no explicit coverage-matching consumer found. |
| `@usb3` | required | Required signature word retained; no explicit coverage-matching consumer found. |
| `@csb0` | required | Required signature word retained; no explicit coverage-matching consumer found. |
| `@csb1` | required | Required signature word retained; no explicit coverage-matching consumer found. |

## Charset metadata

`CT_Charset`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@val` | optional | Transitional-only optional legacy hexadecimal charset, validated/read when present. Strict has no val declaration. |
| `@characterSet` | optional | Optional in both schemas; no explicit consumer found in the current font-table reader. |

## Remaining work and boundary

- Complete characterSet-based declaration semantics. Both schemas have that
  attribute; only Transitional additionally declares val. Current legacy-val
  lookup is not full charset metadata support or Strict import support.
- Complete generic font matching from names, alternatives, family, PANOSE, pitch
  and coverage signatures where applicable. Keep source identities and settings
  distinct from the actually selected runtime face. Do not infer accurate glyph
  coverage/metrics from a family name or a retained metadata record.
- Complete per-run/per-character font-slot and script decisions, theme language
  fallback, inheritance, missing-face selection and edit-time updates with minimal
  authored controls and native comparisons. Existing focused tests establish
  subsets, not every language, font version, simultaneous document or glyph.
- Audit embedding references' relationships, obfuscation/subset metadata and
  licensing separately within authorized scope. This ledger neither implements
  nor certifies those program paths; opaque source retention is distinct from
  decoding or distribution permission.
- Complete required attributes, unknown/duplicate declarations and root/child
  order/occurrence validation. A lazy charset/name lookup is not a schema validator.
  Add focused controls rather than replacing unsupported declarations with
  document-specific font substitutions.

Both schemas' nine type inventories are checked (18 type/variant checks), with
Strict comparison excluding the explicitly Transitional-only charset val row.
Use [audit-section-schema.py](../tools/audit-section-schema.py) with
`--direct-only --type TYPE`, this ledger and its `--ledger-section` title for
child rows. Owning attribute names/use are checked separately.

Existing focused controls include
[canvas-font-families.test.js](../tests/canvas-font-families.test.js),
[canvas-font-alternatives.test.js](../tests/canvas-font-alternatives.test.js) and
[font-family-fallback.test.js](../tests/font-family-fallback.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
