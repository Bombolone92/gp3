# Office Math control-property coverage

Reviewed 2026-10-09 against baseline `f4c34945`, using supplied ECMA-376
Part 1 §22.1 shared math schemas. This covers 21 global/paragraph/operator
property types in each variant, not the entire expression grammar, math runs,
argument properties, nested attributes or imported WML formatting. All selected
types have zero own attributes; their children often carry values.

Evidence: [office-math.js](../src/engine/office-math.js), math import/export in
[docx.js](../src/engine/docx.js), and [office-math.test.js](../tests/office-math.test.js).
Equations retain atomic source XML while surrounding text remains editable.
Display is linear text, not professional math layout or an equation editor.
This existing approximation is useful recovery, not native visual fidelity.

The importer recognizes Transitional m:oMath/m:oMathPara; Strict enumeration
does not establish Strict-package support. Import collapses projected whitespace,
so multiple display-equation separators do not create aligned equation lines.
Equations inside drawing text reject. Supported surrounding edits retain internal
markup; complete copy/revision/story/structural mutation coverage remains open.

## Global math defaults

CT_MathPr. Global math defaults are retained without a settings consumer. Implement typography, break policies, display margins/spacing, continuation layout and limit defaults. Font resources must have approved provenance; font-name settings do not authorize inspecting or distributing font programs.

| Property | Current behavior / remaining work |
| --- | --- |
| `mathFont` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `brkBin` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `brkBinSub` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `smallFrac` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `dispDef` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `lMargin` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `rMargin` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `defJc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `preSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `postSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `interSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `intraSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `wrapIndent` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `wrapRight` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `intLim` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `naryLim` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |

## Math paragraph

CT_OMathParaPr. Paragraph justification is ignored; real display equation lines/alignment remain missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `jc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |

## Fractions

CT_FPr. All fractions become numerator/denominator text with heuristic parentheses. Requested fraction forms, rules and stacked metrics are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `type` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Radicals

CT_RadPr. Radical display is a root token plus argument/degree text. Nonempty degree is emitted even when degHide requests hiding; radical geometry/degree visibility remain missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `degHide` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Delimiters

CT_DPr. A few character tokens are consumed; delimiter growth, shape, sizing and paired layout remain missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `begChr` | Reads opening token, default (. No delimiter geometry. |
| `sepChr` | Reads separator token, default |. No true separator sizing/spacing. |
| `endChr` | Reads closing token, default ). No paired delimiter geometry. |
| `grow` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `shp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## N-ary operators

CT_NaryPr. The operator character is consumed as a token. Limits become _/^ text; placement/growth/hide flags remain ignored.

| Property | Current behavior / remaining work |
| --- | --- |
| `chr` | Reads operator token, default integral. No professional sizing/limit geometry. |
| `limLoc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `grow` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `subHide` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `supHide` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Equation arrays

CT_EqArrPr. Entries join with semicolons; baseline alignment, row spacing and distance geometry are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `baseJc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `maxDist` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `objDist` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `rSpRule` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `rSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Matrices

CT_MPr. Rows/columns join with punctuation; baseline, placeholders, spacing and nested column specifications are ignored.

| Property | Current behavior / remaining work |
| --- | --- |
| `baseJc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `plcHide` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `rSpRule` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `cGpRule` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `rSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `cSp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `cGp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `mcs` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Subscripts

CT_SSubPr. Subscripts become underscore text; real script metrics and placement are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Superscripts

CT_SSupPr. Superscripts become caret text; real script metrics and placement are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Combined scripts

CT_SSubSupPr. Combined scripts become _/^ text; script alignment and metrics are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `alnScr` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Prescripts

CT_SPrePr. Prescripts become _/^ text before the base; actual pre-positioned script geometry is missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Accents

CT_AccPr. Selected accent character is appended as a token. Positioning, stretching and math shaping remain missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `chr` | Reads accent token, default combining circumflex. No professional accent positioning/stretching. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Bars

CT_BarPr. Linear display always appends an overbar token; pos is ignored, including requested below placement.

| Property | Current behavior / remaining work |
| --- | --- |
| `pos` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Boxes

CT_BoxPr. Generic argument concatenation; operator emulation, math breaks, differential and alignment semantics are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `opEmu` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `noBreak` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `diff` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `brk` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `aln` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Border boxes

CT_BorderBoxPr. Generic argument concatenation; border visibility and strike geometry are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `hideTop` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `hideBot` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `hideLeft` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `hideRight` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `strikeH` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `strikeV` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `strikeBLTR` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `strikeTLBR` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Grouping characters

CT_GroupChrPr. Generic argument concatenation; grouping character, position and vertical justification are ignored.

| Property | Current behavior / remaining work |
| --- | --- |
| `chr` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `pos` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `vertJc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Phantoms

CT_PhantPr. Generic argument concatenation emits visible text; show, zero dimensions and transparency are ignored.

| Property | Current behavior / remaining work |
| --- | --- |
| `show` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `zeroWid` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `zeroAsc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `zeroDesc` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `transp` | Retained, ignored by current projection/settings path; implement this property's semantics with the family layout above. |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Functions

CT_FuncPr. Function name and argument separated heuristically; professional function typography and control formatting are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Lower limits

CT_LimLowPr. Limits become underscore text; actual below placement and metrics are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Upper limits

CT_LimUppPr. Limits become caret text; actual above placement and metrics are missing.

| Property | Current behavior / remaining work |
| --- | --- |
| `ctrlPr` | Retained, omitted from projection; implement applicable control formatting/metrics and audit imported WML properties separately. |

## Evidence and next work

Properties are generally retained without a complete validating/applying math
reader. Character-token support does not implement style, size or geometry.
Unknown math content can fall through traversal; retention is not proof that
all constructs produce a complete or semantically accurate linear result.

The existing independently authored quadratic formula test proves linear
projection and retention after surrounding insertion, not all constructs,
native defaults, professional layout or every mutation. No new runtime/native
test run or newly completed template is claimed by this documentation audit.

Prioritize real equation layout for fractions/scripts/radicals and math run
metrics, then stretchy delimiters/operators, matrix/array alignment and visibility/
geometry controls. Nested arguments, script-size levels, control formatting,
breaks and matrix columns need independent inventories. Use authored equations
and native comparison; preserve source when unsupported properties remain and
never replace equation XML with its linear approximation on save.

## Inventory verification

Use [audit-section-schema.py](../tools/audit-section-schema.py) with --direct-only,
--type and each matching section title. Direct-only does not expand child types
requiring imported WML groups and does not claim to resolve those imports.
Parent choices/occurrences, nested attributes, imported types and full semantic
applicability remain outside these name checks.

Supplied shared-math.xsd hashes:
Strict `4c6e2aaed399993c80e67e848752dd9c0e177a8b671cf792f0c820496d037823`;
Transitional `132e44dc10f2959e3f585584e5d82e7b2e329691e3010646e497710bd9774152`.
Full math support and roadmap A01 remain open.

All 42 type/variant checks matched child row sets without missing, extra or
duplicate names and confirmed zero own attributes. All relative links resolved.
The new direct-only tool mode passed a synthetic unresolved-child boundary
control and CLI ledger check. Default expanded outputs for 84 preceding WML/
DrawingML type/variant checks exactly matched the pre-change tool. These checks
validate the audit utility and inventory boundary, not professional math layout.
