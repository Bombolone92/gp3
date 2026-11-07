# Story-margin holdout for physical table placement

`tools/print_section_phase_fixture.py story-margin` authors eight textless
one-cell tables directly in OOXML using the independently authored row-phase
package shell. Letter paper, half-inch side/bottom margins, zero cell margins,
216pt grid and single 1pt borders stay fixed. Exact row heights are 403/406
twips, origins are 720/4455 twips, and header/footer margins alternate between
zero and 720 twips. Every table starts a separate next-page section.

Reproduce into a fresh directory with
`python tools/print_section_phase_fixture.py story-margin --output-folder PATH`.
Nonempty destinations, including this captured fixture, are rejected before
writing. A new owned source requires its own native capture.

Captured source SHA-256:
`900cef83a0ad6d75e6ce754c14c438479fa1ff3c64857ac74789b7d9cb28d6b4`.
An exact owned copy was opened with the reference-application helper and then in the visible reference application. The public read-only metafile capture checked the saved/visible
state, eight page dimensions and unchanged source bytes before and after.
`native-metafile-rectangles.json` binds source/case hashes and private metafile
hashes to raw 600dpi rectangle destinations and clipping. Native metafiles and
any font resources remain private; no PDF is used for this control.

Native far bounds in case order are
`476, 476, 478, 478, 2032, 2032, 2034, 2034`.
Each margin pair has identical blue fill operations, not just identical outer
bounds. Thus the low-origin 406-twip discrepancy is independent of story
margins: a float32-in-points far-bound shortcut still predicts 477 instead of
478 for both zero and half-inch margins. This rejects a possible explanation
for the earlier low-origin holdout; it does not establish a replacement rule.
Authored dimensions and production rendering remain unchanged.

Unit coverage verifies the actual source section/row declarations and capture
hashes. Browser coverage checks eight editable pages, no-edit part preservation,
editing/export/reopen and undo restoring original package parts. The generator
reproduces captured case bytes/package parts without requiring identical ZIP
timestamps. A new native capture is required if the captured source is replaced.
