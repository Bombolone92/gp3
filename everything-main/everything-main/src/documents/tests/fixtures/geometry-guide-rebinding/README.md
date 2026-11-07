# Repeated DrawingML guide names

Original control XML authored by `tools/geometry_guide_rebinding_fixture.py`,
using the project's own custom-geometry fixture as an OPC/shape shell. No corpus
content or third-party implementation is used. `native.pdf` was exported by
the reference application without saving the source document.
`tools/record_geometry_guide_rebinding.py` records green bar bounds at 288 DPI
and the source DOCX SHA-256. The browser comparison uses a 0.6pt tolerance.

The nine controls distinguish:

- Repeated guide and repeated adjustment declarations: latest value wins.
- Earlier dependent guides retain their calculated values after replacement.
- A guide replaces an adjustment of the same name.
- An explicit guide can replace the built-in width value.
- Ordinary self-reference, both initial and repeated, resolves to zero during
  that declaration: addition yields its literal offset; doubling yields zero.

ECMA-376 Part 1 §20.1.9.11 specifies ordered calculation; §20.1.9.11–12 and
ST_GeomGuideName do not impose unique names. Self-reference is not explicitly
defined there: the zero binding is measured reference behavior, not
a claim that the specification mandates it. Built-in self-reference remains
unsupported; an exploratory width self-reference produced off-page reference ink.

All nine bars are on one page. Browser checks compare each bar before and after
body edits, undo and reopening; unit checks verify retained custom geometry XML
and untouched package parts. Undo restores every original OPC part exactly.
