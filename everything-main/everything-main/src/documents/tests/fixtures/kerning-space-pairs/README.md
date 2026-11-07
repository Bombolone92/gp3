# Unresolved native kerning of space pairs

`tools/canvas_kerning_space_pairs_fixture.py` writes original OPC/XML directly.
The five paragraphs compare a single run, split runs, temporary content controls,
another pair sequence, and disabled kerning. All use installed Rockwell Bold at
18pt with -1.5pt character spacing. No font file is redistributed. `native.pdf`
was exported from the exact source in the reference application without saving.

This is a diagnostic fixture for an **open rendering issue**, not a passing
fidelity regression. The reference application centers the first three lines at x=228.05pt. Edge's
Canvas renderer places them at x=227.088867pt. Changing run/control boundaries
does not remove the difference. With kerning disabled, the reference application starts at 225.53pt
and Canvas at 225.467285pt. The larger error therefore depends on kerning.

The native reference PDF advances include approximately -0.1em kerning for both space–W and
W–o. The installed Rockwell Bold `kern` table has -205 design units for both
pairs at 2048 units/em. Edge Canvas applies W–o but not space–W: at 24 CSS px,
space plus W measures 29.765625px in both kerning modes, while W–o changes from
37.5234375px to 35.12109375px. `textRendering=optimizeLegibility` and
`geometricPrecision` do not restore the missing pair. The behavior also occurs
without condensed spacing and with NBSP. These observations isolate a native
shaping limitation rather than missing bold formatting or a content-control bug.

ECMA-376 Part 1 §17.3.2.19 (`kern`) enables font kerning at the specified size
threshold; §17.3.2.35 (`spacing`) supplies character spacing. The reference application follows the
font's pair data in this probe. This is not an identified reference/spec divergence.
There is no template/font-specific offset in the engine. Authorized Local Font
Access now exposes pair data, but the September 29 in-memory kern-to-GPOS
candidate was withheld: it fixes these title origins but increases validation
cost and leaves nonbreaking-space cases unresolved. The hash-bound browser
test now records the native mismatch as an explicit expected failure. The
broader original control is in `tests/fixtures/legacy-space-variants`.
