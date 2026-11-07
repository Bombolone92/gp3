# Synthetic bold: diagnostic control, not a completed rendering feature

The original generator authors 24 paragraphs as OPC/XML without application
serialization or embedded font files. Six installed font names each have normal,
bold, italic and bold-italic cases at 24pt with 42pt exact line spacing. The reference application opened the exact DOCX and exported the retained two-page PDF.
The recorder binds source/PDF hashes and reads PDF text rendering modes, font
names and stroke widths independently of the application's layout or paint code.

The reference application uses fill-plus-stroke (`2 Tr`, 0.68571pt = approximately 24/35pt) for bold
Franklin Gothic Demi and Book, including their italic faces. Arial and Times New
Roman select distinct bold faces without synthetic stroke. Arial Black and the
explicit Arial Bold face use no extra stroke, even with bold requested. This
counterexample prevents a blanket rule that strokes every font whose native
normal/bold rendering is identical.

A separate browser probe found Franklin Gothic Demi's native normal and bold
renderings identical: the same 129.3476pt advance and 666.9375pt² dark-pixel area
for `BOLD LOCAL FACE` at 15.96pt. Adding a 1/35-em stroke changes area to 784.4375pt²
without changing advance. That probe is diagnosis, not a production policy.
PANOSE weights in the corpus font table are a possible further lead, not yet a
verified basis for deciding whether to synthesize a missing bold style.

This control opens as two editable pages without errors and passes body edit,
export/reopen, unchanged unrelated parts and exact-package undo checks. Its
synthetic bold and all-font pixel fidelity remain explicitly unimplemented.

Later verification distinguishes upright Book from the still-ambiguous cases:
`tests/browser/synthetic-bold.spec.js` now explicitly checks its detection.
The current painter already synthesizes upright Book with em/35. A 384dpi
corpus heading comparison measures approximately 1.8% green-ink difference
from the reference application, consistent with the existing 5% ink bound. The early statement
above that all synthetic-bold rendering is unimplemented is historical;
`synthetic-bold-ink` documents the shipped generic detection/paint support.
Demi and Book's separately selected italic face remain unproven here.

Authorized local metadata now resolves the Demi/Demi Italic ambiguity above.
`metadata-ink.json` binds the same original source and native PDF to 384dpi
ink samples, recorded by `tools/record_local_font_ink.py`. The browser checks
the four Demi and four Arial Black styles; on the reference machine, the
two newly corrected Demi bold styles are within 0.21% of the reference application's ink area.
The test retains the existing 5% tolerance. Permission-denied/unavailable
contexts keep the former approximation. The synthetic advance remains open.

The eight-paragraph `weights.docx`/`weights-native.pdf` boundary control keeps
Segoe UI Semibold (600) and Dubai Medium (500) out of the new override: the reference application
uses fill-only text for both even with bold requested. Consequently metadata
can override unchanged browser ink only for normal-or-lighter faces (weight
at most 400), not every weight below 700. The browser test checks Semibold as a passing guard and retains Dubai
Medium as a separate pending case, alongside the Arial Black guard. Font names are test inputs only.

This control also records Segoe UI Semilight (350), where the reference application emits no
stroke despite the browser synthesizing one, and Franklin Gothic Medium
(400), where the reference application does add the stroke. Semilight's existing difference is
separate: its browser regular and bold ink already differ, so the new
unchanged-ink override does not apply. Metadata alone is never sufficient;
the raster comparisons remain required. No new universal weight-to-synthesis
rule is claimed.

Dubai Medium is also an existing raster-only synthesis gap: its browser
regular/bold ink differs, so it already entered the old stroke path before
metadata was added. It has a separate strict expected-failing test. The
new override does not apply to it. Semibold, whose browser regular and bold
ink are identical, is the passing boundary guard that prevented the proposed
below-700 override from introducing a regression.

Regenerate the weight boundary with `tools/local_font_weight_fixture.py`,
export it with `tools/export-reference.ps1`, and record the native PDF
operators with `tools/record_local_font_weights.py`.

## Subsequent exact-weight correction

The Dubai/Semilight gaps above are now corrected with authorized local metadata.
The independently generated `../synthetic-bold-weight-metadata` control varies
only OS/2 weight and unique face identifiers while preserving outlines and other
metadata. Its 42 paragraphs show that native reference adds its synthetic stroke only
at exact weights 300 and 400, including tests at 299/301 and 399/401. This
supersedes the earlier normal-or-lighter hypothesis; the native advance remains
an independent decision. No family name is used by the production rule.

`weights-ink.json`, generated by `tools/record_local_font_ink.py --weights`,
records all eight native 384dpi samples. The browser test now checks actual
regular/bold pixels for all four families, replacing the pending Dubai flag-only
assertion. Dubai bold's ink ratio improves from 1.2978 to 1.0005 and Semilight
bold from 1.4920 to 0.9971. All eight pass the unchanged 5% native ink bound.
Permission-denied and unavailable metadata retain the prior approximation.
