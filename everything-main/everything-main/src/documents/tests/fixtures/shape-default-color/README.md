# Document-default shape text color

`tools/shape_default_color_fixture.py` derives an independent 36-case matrix
from the project's original shape-auto-color fixture, adding explicit
`w:docDefaults/w:rPrDefault/w:rPr/w:color` value `112233`. It does not copy any
corpus markup or font resources. The reference application exported `native.pdf`.
`tools/shape_default_color_reference.py` records native glyph RGB, crops and
source/PDF hashes. All 36 native crops were visually inspected together.

The six omitted-color cases use document-default `112233`, despite their white
or red shape font references. Explicit automatic paragraph, character-style or
direct colors still use fontRef. Explicit blue remains blue, and automatic
color without fontRef still contrasts with the shape fill. Both this matrix
and the original matrix pass browser color/coverage checks through body edits,
exact undo, unrelated-part preservation and export/reopen. Sources and browser
exports pass the XML schema checks.

ECMA-376 Part 1 §17.7.5.1 describes document defaults; §17.3.2.6 describes run
color; §20.1.4.1.17 describes the shape font reference. The new matrix extends
the existing native precedence evidence to explicit document-default color.
It does not change font-family/size precedence or the previously recorded
automatic-color behavior. No additional reference/spec divergence is claimed.
