# Axis-line pen-width holdouts

Generate with `python tools/axis_line_display_fixture.py --pens`. Forty-eight
original, independently authored textless lines cross horizontal/vertical axes
and four fractional phases with 0.5, 0.75, 1.5, 2.25, 3 and 4.5pt flat pens.
At 100% zoom/DPR 1 they occupy device pens 1, 1, 2, 3, 4 and 6.

The prior opaque inclusive-endpoint correction is withdrawn (2026-10-10).
It matched threshold-128 JPEG bounds by making half-gray cap pixels black.
The unchanged original projection matches all 48 dark-core bounds and 80
half-gray samples at 100%. A fresh reference capture matches
48 cores and 160 half-gray samples at 75%. Source bytes remain unchanged/Saved.
Original threshold-128 references/assertions remain explicit expected failures.
Exact native endpoint alpha and arbitrary-path/cap fidelity remain open.

The native 75% paper origin is (325,91), at the observed page-outline boundary.
The first white interior column is 326 and must not be mistaken for the origin.
The neutral crop starts at (358,112); no registration is fitted to artwork.
`word-coverage-reference*.json` binds source/cases/crops and capture hashes.
Only independently authored neutral lines are shipped, not corpus content,
reference application binaries or font programs.

Reproduce 100% references with `python tools/record_axis_line_coverage.py`.
To recreate 75% from the private full screenshot, add `--capture75 CAPTURE.jpg`.
Dark cores use max(R,G,B)<96. Half-gray samples use values 96–192 with a maximum
32-channel JPEG allowance, rejecting opaque-black/white substitutions. JPEG
is not an exact coverage oracle. Source/undo/reopen, unchanged physical print
and dashed-control regressions are retained in the shared browser suite.

See the paired `axis-line-display/README.md` for standard scope and original
resource provenance. No original document is promoted by these controls.

The 2026-10-10 physical-print correction supersedes main-baseline print hashes,
which encoded screen-rounded pen widths. Tests now check physical widths and
cache repeatability, while retaining dashed screen hashes and native screen
coverage assertions. This does not certify native PDF pixels.
