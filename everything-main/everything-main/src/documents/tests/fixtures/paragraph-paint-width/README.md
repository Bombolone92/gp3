# Paragraph decoration width

The four original generators in `tools/paragraph-paint-width` author five
OPC/XML controls. Run `paragraph-border-width-control.py` first, then the other
three. Each fixture's uncompressed ZIP entries match the input opened in the reference application.
The reference application confirmed each exact path, exported the retained PDF and closed without
saving. JSON records PDF SHA-256 hashes and vector fill bounds in points.
There are 27 native reference pages.

- Nine font/size cases compare body and cell paragraphs (Arial, Courier New,
  Times New Roman and Century Gothic). All retain the same decoration bounds.
- Two one-page controls change document defaults while retaining explicit
  paragraph fonts. Neither changes the bounds.
- Eight distance/width cases vary border space from 0 to 20pt and thickness
  from 0.25 to 4pt. The additional horizontal extent remains approximately 1.5pt
  per side, separately from the declared border distance and line width.
- Eight side controls include plain shading, individual sides, top/bottom,
  explicit none and zero-width borders. Plain shading has the same extension.

For example, the first control's text starts at 72.024pt. At zero border space,
the reference application's fill starts at 70.584pt; at space=10 it starts at 60.624pt. The 600dpi
PDF geometry quantizes nominal 1.5pt and 10pt to approximately 1.44 and 9.96pt.
The renderer keeps logical CSS geometry (1.5pt = 2px) and tolerates sub-point
PDF quantization. Text advances, wrapping and caret positions do not change.

ECMA-376 Part 1 §17.3.1.31 (`shd`), §17.3.1.24 (`pBdr`) and §17.3.4
(`CT_Border`, including `space`) describe shading and border offset. The fixed
horizontal extension is a measured reference convention not prescribed by those
clauses; it is not encoded into exported OOXML. The controls distinguish it
from font metrics, authored indents, border spacing and border width.

Separate pre-existing limitations exposed by the side controls remain open:
The reference application does not extend shading across a lone left border's distance, and retains
space for explicit `none` and zero-width border declarations. `compareFill`
is false for those three cases. The reference application also paints a hairline for the zero-width
case, which the engine does not yet paint; `compareBorder` is false there.
Other active border coordinates are checked, but full shading/vertical fidelity
is not claimed for those cases.
The width fix does not change border activation or spacing-collapse semantics.

Unit and browser tests compare the remaining body/cell fill bounds and active
border extents, then check edit/export/reopen and exact undo. Browser bounds
are measured at double device scale to limit pixel quantization.
