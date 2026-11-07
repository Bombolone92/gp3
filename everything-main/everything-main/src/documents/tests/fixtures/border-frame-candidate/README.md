# Rejected frame-relative display candidate

`rejected-device-layout.js` is original diagnostic code derived from this
repository's painter at 9e2ad72c. It is only loaded by a Playwright route at the
normal engine URL, so its relative corner-module import resolves there. It is
never imported into the production application. No new native capture,
third-party code, font program or document-specific condition is used.

The proposal uses a preceding whole-twip origin, minimum-width compensation
for thin vertical bodies, a frame-relative advance for wide exposed bottoms,
physical-grid trailing clipping, and inward growth constrained by the rounded
frame extent for thin bottoms. These are hypotheses, not established reference
rules. In particular, `cellIds.length===1` is insufficient proof of a general
exposed-edge semantic, and mixed border families need independent evidence.

It reproduces all 1,024 straight-body bands in `border-axis-phase` at 100%/200%
and all 480 dense-phase bands at those two zooms. It still fails the dense
175% sweep: the first four tables paint bottom [56,57), while the reference application paints
[55,56). The other 236 dense bands at 175% match. Passing the earlier subset
therefore cannot justify shipping the proposal.

`tests/browser/border-frame-candidate.spec.js` repeats these comparisons at
source-positioned samples and asserts the native counterexamples. It also
checks source geometry immutability, editable opening, no preview errors and
unchanged exported package parts. Native PNG/provenance reproduction remains
in the independent axis/body/dense tests. No incorrect current-viewer pixel
positions are installed as application goldens.

Private complete-region comparisons retain two axis cap discrepancies and
colored-fill edge discrepancies; no full-pixel, arbitrary-zoom, mixed-border,
print or corpus equivalence is claimed. The next rule must cover the fractional
zoom frame boundary and coordinate fill edges as well as bodies and caps.
