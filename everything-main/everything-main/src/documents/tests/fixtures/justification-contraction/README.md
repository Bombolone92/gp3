# Native justification contraction controls

These original text-only controls isolate the body-wrap discrepancy in corpus
#180 and the earlier justified-line-fit gap. They contain no corpus text or
artwork. Eight packages contain 197 independently exported reference pages:

| Package | Pages | Purpose |
| --- | ---: | --- |
| sweep | 36 | Identical Calibri/Arial prose, paired left/justified alignment, widths near compression boundaries |
| edges | 22 | Final/wrapped lines, four fonts, NBSP, mixed space sizes/fonts, leading/trailing/repeated spaces, soft breaks |
| edges-no-expand | 22 | Same cases with doNotExpandShiftReturn enabled |
| edges-mode14 | 22 | Same cases in compatibility mode 14 |
| clusters | 30 | One/two/three consecutive spaces, width sweeps, wide left-aligned controls |
| limits | 13 | Separate per-space and total-line compression limits by changing word lengths |
| joined-clusters | 30 | Same cluster cases with adjacent identical runs joined |
| balance | 22 | Bracket exact reference boundaries with varying word counts, last spaces and last-word lengths |

`cases.json` holds explicit text, fonts and physical widths. Some widths were
chosen from browser natural advances to straddle the boundary; expected line
breaks come only from the reference application. Source/PDF hashes and native
non-whitespace line text/origins are pinned in `reference.json`.

Regenerate with `tools/justification_contraction_fixture.py`. All regenerated
OPC parts were compared with the packages used for the reference application export. Export each
package using `tools/export-reference.ps1`, then run
`tools/record_justification_contraction.py`. The no-expand control was corrected
to place its compatibility element in schema order and exported again.

Ten reference tests verify hashes, page/case mapping and the independently
observed distinctions. They validate evidence; they do not assert that the
renderer implements contraction. All eight source packages pass 64 XML checks.

With Vite running, execute:

```
node tools/check-justification-contraction.mjs <output-json>
```

This diagnostic requires the installed reference fonts and exits nonzero on
mismatched line breaks. At engine commit d684b454 it reported 65 mismatched pages: sweep 11,
edges 12, no-expand 12, mode14 0, clusters 11, limits 8, joined-clusters 11.
The modern contraction implementation matches all 197 pages. The browser suite
also compares contracted fragment widths with native Canvas measurements.
Matching line text alone does not certify baseline/paint/caret fidelity.

Native observations:

- Mode 15 contracts ordinary proportional-font spaces; mode 14 controls do not.
- Single-space boundary cases agree with a 25% per-space maximum. Mixed-size
  spaces contract proportionally. Final and manual-break lines also contract;
  doNotExpandShiftReturn does not prevent this contraction.
- NBSP and Courier New spaces retain their widths in these contraction controls.
- The second limit compares contraction with expansion of the shorter line,
  weighting shrinkage twice as heavily. If D is overflow, S is eligible natural
  space width, E is spare width without the last word and P is that shorter
  line's eligible space width, the condition is 2D/S <= E/P. This is separate
  from D/S <= 25%; it is not a fixed percentage of overall line width.
- In three Calibri 20 pt paragraphs of equal natural width (216.6 pt), changing
  only the distribution of letters gives minimum widths 209.75, 206.2 and
  202.7 pt for last words of one, two and three letters. The balance controls
  bracket these and eight word/space-count boundaries by 0.15 pt on either side.
- Joining identical adjacent runs leaves all thirty cluster line breaks intact.

The engine now applies mode-aware fitting and proportional negative spacing,
including signed leading-fragment correction. Unit and browser controls cover
caret/selection geometry, export/reopen, exact undo and nonbreaking whitespace.
The three justified-line-fit expected failures now pass normally. Extended
contraction around tabs and discretionary hyphens remains pending.

ECMA-376 Part 1 §§17.3.1.13 and 17.18.44 define inter-word justification without
this numerical fitting algorithm. A separate legacy MS-OE376
[compatibility note](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/faeffa01-a15f-4e62-b63c-023901149d29)
describes an effective-width factor of 1 + 281/7200. These controls do not enable
wpJustification, so that legacy formula is not evidence for the modern limit.
