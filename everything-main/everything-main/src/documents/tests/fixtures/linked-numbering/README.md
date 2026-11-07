# Linked numbering definitions

Original controls manually authored with `tools/linked_numbering_fixture.py`.
Sixteen paragraphs isolate direct numbering, two aliases, nested levels,
target-instance overrides, caller overrides, inherited numbering styles,
local levels beside a link, a backlink without a style numId, and a conflicting
style numId. The reference application exported the retained one-page PDFs read-only.
`record_linked_numbering.py` records markers, source/PDF hashes and 96-DPI images.

The two pages were visually inspected. In control.docx, the reference application follows the
abstract's styleLink backlink, including the numbering style's basedOn chain.
The numbering style's numId is not authoritative: BACK-1 and RIGHT-1 demonstrate
resolution with an absent or conflicting numId. Target-instance overrides do
not carry across. Alias abstracts have independent counters; two instances of
one alias share a sequence and caller restart overrides. Local levels beside a
valid numStyleLink are ignored. These results implement ECMA-376 Part 1
sections 17.9.21 and 17.9.27; no specification divergence is asserted.

no-backlink.docx removes all styleLink elements. The reference application omits markers/indentation
for empty aliases and retains the local level when present. Empty unresolved
aliases remain guarded by this implementation; this reference does not claim
editable suppression support. Missing/ambiguous styles and cyclic inheritance
or links are also guarded. Unused unsupported definitions stay retained.

Unit tests check all native labels and text edits, splits, restart, exact undo,
reopen and package preservation. Browser checks compare black glyph masks
against the reference application in both directions, allowing one pixel displacement and fewer than
0.5% unmatched ink pixels. This avoids conflating gray antialiasing coverage
with position. The initial gray-pixel comparison failed; the glyph-mask check
replaces it rather than relaxing its positional tolerance. The fixture heading
is outside the comparison because the editing test inserts text there.
