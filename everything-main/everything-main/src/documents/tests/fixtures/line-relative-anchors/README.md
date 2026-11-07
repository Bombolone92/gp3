# Line-relative floating picture controls

Original XML and a generated blue PNG use the existing original package shell
from `canvas_anchor_position_fixture.py`. No corpus artwork, third-party engine
or font binary is included. The generator uses Python stdlib and lxml (BSD).
The reference application independently exported `native.pdf`; the reference binds source
and PDF hashes and records each picture's bounds.

The eight pages cover the first line, a second manual line, an automatically
wrapped word containing an anchor, a paragraph-relative control, positive and
negative offsets, paragraph before-spacing, and larger exact line spacing.
The wrap control has no preserved whitespace around its drawing, deliberately
proving that a floating anchor does not separate the surrounding word.

Part 1 §§20.4.2.11, 20.4.2.12 and 20.4.3.5 tie a numeric line-relative offset
to the line containing the anchor character. The reference application's observed positions agree:
the origin is the line box top, not its baseline or the paragraph's first line.
The native Y positions are 72, 90, 126, 72, 108, 84, 90 and 108 points.

Regenerate the package with `python tools/line_relative_anchor_fixture.py`.
Export that package with `tools/export-reference.ps1`, saving `native.pdf`
in this directory, then run `python tools/record_line_relative_anchors.py`.
Never regenerate the native reference from browser geometry.

Current support is numeric, unwrapped body/story line-relative placement.
Line-relative alignment, wrapped anchors, cell-relative combinations and
explicit page/column breaks remain unsupported; they require separate native
controls before enabling editing. Header/footer controls and automatic
pagination also require broader verification. This fixture is not a claim
that every DrawingML anchoring combination is implemented.
