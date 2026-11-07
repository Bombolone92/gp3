# Numbering cancellation inside styles

Original OOXML fixture: `tools/numbering_cancel_style_fixture.py` generates
`public/fixtures/numbering-cancel-style.docx`. The reference application exported `native.pdf`;
`tools/numbering_cancel_reference.py` records the source/PDF hashes and
24 image origins in `reference.json`. The blue PNG is generated locally.
No corpus content or third-party document engine is used.

Twelve pages contrast numbered/unnumbered ancestors with a cancelling style,
then same-style, child-style and direct indentation. Each paragraph contains
pictures on two lines so first-line and subsequent-line origins are separate.
Native origins are 72/72, 102/102, 78/72, 96/96, 81/72, 108/108 pt, repeated for
the numbered ancestor. Right indentation remains 12 pt in the resolved format.

ECMA-376 Part 1 §17.9.18 specifies numId=0 removal of numbering properties at a
style-hierarchy level. The reference application additionally clears inherited left/first-line
indentation at that level, including unnumbered ancestors. Declarations at the
cancelling level and descendants survive. This qualifies the earlier direct
paragraph controls; it does not change the authored style definitions.
