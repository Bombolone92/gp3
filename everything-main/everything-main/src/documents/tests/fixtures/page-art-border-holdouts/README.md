# Independent page-art border holdouts

`tools/page_art_border_holdouts.py` authors nine OOXML cases on eleven pages.
They cover left/bottom/right-only borders, an omitted top edge, an ordinary top
with art on other sides, unequal colours, two-page firstPage/notFirstPage
visibility and back z-order. No art tiles, corpus parts, font programs or native
paths are included. The generator reuses the repository's authored OPC shell.
The existing six-page control regenerates byte-for-byte after the shared builder
extension. The new source passes the standard XML schemas.

`native-measurements.json` records a fresh reference-application UI PDF export
from the exact owned, visible control. Source bytes were unchanged. Saved to this
PC and disabled Undo were observed before and after export. The PDF stays private.
The graphical reader records bounds, colours, object counts and hashes, without
reading font resources or publishing artwork contours. These measurements do
not establish glyph/visual fidelity or runtime support.

Native findings:

- Each single-sided control paints three pieces: its edge and two corner endcaps.
- Omitting the top still paints seven pieces, including all four corners.
- An ordinary top with art on the remaining sides paints an eight-piece art frame.
- The unequal-colour control declares top/left/bottom/right as AA2200/008844/
  2244AA/993399. All eight native pieces use the right-side colour, RGB
  `(0.6,0.2,0.6)`. This one control does not establish a universal precedence rule.
- The two-page visibility controls paint no art on the excluded page.

ECMA-376 Part 1 17.6.2, 17.6.10, 17.18.2 and Annex F describe page art borders.
The previously recorded reference use of authored colour despite the art-colour
exception remains relevant. Side composition and shared-frame appearance must
be implemented as frame semantics rather than four independent line strokes.
No new general reference/specification divergence is claimed by these holdouts.

Implementation still requires approval for the eight Ecma custom-licensed
handmade1 tiles, then native/browser comparison, theme/colour checks, editing and
untouched-package verification. The original Funny Fill Ins document remains
partial and read-only. These controls do not remove its import guard.
