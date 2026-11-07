# Numbering cancellation and inherited indentation

Original source: `tools/numbering_cancel_indent_fixture.py`. The 8-page fixture
uses original solid-blue PNG artwork, body and fixed-cell paragraphs, a style
with an 18pt left indent, a numbered style based on the level-linked ListBullet
style, and explicit
`numId=0` cancellation. The reference application exported the unchanged source to the
retained PDF. `tools/numbering_cancel_reference.py` records image placement
matrices and binds the source and PDF by SHA-256.

For the unnumbered style, cancelling numbering changes centered body image x
from 196.5pt to 187.5pt, and oversized cell image x from 90pt to 72pt. Thus the
reference application removes inherited left indentation even when there was no inherited numbering.
This is not a chart-specific alignment adjustment. The companion `-direct`
controls distinguish inherited first/right indents and direct overrides.

ECMA-376 Part 1 §17.9.18 says zero removes numbering properties at that style
hierarchy level. The reference application additionally resets inherited left/first-line paragraph
indents; this behavior is not explicitly described by that clause. Authored
style properties remain intact in the DOCX. These controls establish horizontal
placement, not complete vertical text/pagination fidelity.
