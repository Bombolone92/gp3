# Shared-border origin invariant and rejected leading-only candidate

`tools/border_shared_origin_fixture.py` authors two original OPC/XML packages.
Both contain one floating 2x2 table, two exact 600-twip rows, zero cell margins,
single 2/8pt black rules and empty one-point paragraphs. The page anchor is
360x309 twips. Only the shared horizontal rule's source owner changes: the
preceding row's bottom side or the following row's top side. The opposing side
is `nil`. No corpus content, pictures or fonts are embedded.

ECMA-376 Part 1 §17.4.66 (`tcBorders`) and the existing conflict implementation
allow the visible opposing rule to win over `nil`. Both imports resolve the
same physical cell and border geometry. The current painter produces identical
complete border-only PNGs at 100% and 200%; no-edit package parts remain exact.
These began as equivalence controls. The native follow-up below now provides
independent reference screen and page-metafile references for the same exact sources.

`rejected-candidate.js` archives an unshipped paint-only experiment against
1e6d9f1e. It projects strictly preceding 600-DPI grid points for leading
coordinates and compensates thin left rules by one device pixel, while leaving
right and bottom origins unchanged. It matches all 448 isolated native left/top
pairs in the phase families, improving 444 of 2,048 measured ink/fill edges
without worsening an edge there. Those samples do not establish general safety.

The paired shared-border sources expose the defect: at 100% the candidate puts
the same resolved rule at y=60 or y=61 solely according to declaration owner.
The current painter keeps both at y=61. A synthetic resolved-cell control proves
the same issue independently of import. No native fidelity tolerance is relaxed.
The candidate is imported only by diagnostics/tests and is rejected for shipping.

Reproduce isolated native comparisons with Vite on 0.0.0.0:5173:

```
node tools/probe-border-leading-candidate.mjs <scratch-output-directory>
npx vitest run tests/border-leading-candidate.test.js
npx playwright test tests/browser/border-shared-origin.spec.js --config=.private-teacher-confirmation.config.mjs
```

The next model must distinguish an exposed trailing edge from a shared physical
boundary without depending on the winning source side. Native connected-table
positions, clipping and trailing endpoints still need validation before a
general origin correction is integrated. Planner #226 remains partial.

## Native follow-up

The reference-opening helper confirmed exact owned source copies. The reference application displayed
both at 100% and 200%; selection handles were removed and pointer highlights
kept outside measured regions. The visible paper outline establishes page origin
independently of table ink. A caret at the empty page corner is outside the crop;
outline segments away from that corner are checked, with no ink masking.
Source hashes and Saved true were verified after capture; no pagination query,
source edit, font installation or source formatting change was performed.

All three vertical and horizontal bands match across ownership variants at
both zooms, and all 25 source-free PATCOPY page-metafile rectangles are identical.
At 100% the native horizontal bands are [21,22], [61,62], [100,101]. The isolated
600-DPI leading model predicts top=20 rather than native top=21 here. Thus even
the previously successful outer-leading rule does not generalize to connected
tables. Native PNGs, compressed metafiles and metadata are hash-bound in
`reference.json`; the original inspected JPEG captures stay in scratch.

```
python tools/record_border_shared_screen.py <private-capture-directory>
```

The recorder requires four inspected JPEGs and two native page metafiles plus
exact-path capture metadata. It reproduces the four crops and archived records.

## Frozen sources for rejected diagnostics

The relative and width-threshold experiments now load archived original engine
sources rather than pinning the evolving production renderer. No historical
measurement or expected hash changes. `baseline-border-device-layout.js` is
the unchanged module at 804c004c (canonical LF SHA-256
`e46d90c45a32ee8d61da4e4a86013ec6c06f4281183846c67b3ed76f437879e1`).
`baseline-canvas-editor.js` is the exact historical editor at
2ecb5b313539694a86bb0e9286541e4e4566976f (canonical LF SHA-256
`426f415e411b8f7ea7d829eb51560a649a776f1b0fb768f9d4246934a11a4b09`).
Both are this repository's original code, retained only for routed diagnostic
tests. The rejected frame experiment also uses this archived editor; route
patterns include Vite's module query strings so it cannot silently test the
current renderer. Production imports neither snapshot.
