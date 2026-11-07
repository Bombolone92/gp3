# Character spacing on inline pictures

The original XML generator creates five 144×72pt inline ellipse pictures with
run spacing of 0, +10, -10, +50 and -50pt, each followed by unspaced NEXT text.
It reuses this project's original image artwork and independent ellipse package.
The reference application places every picture at x=36pt with width=144pt and every following
text origin at x=180.05pt. Thus spacing does not add to the picture advance or
stretch its painted frame. The PDF recorder retains the source/PDF hashes and
all five placements. No application serializer generates the control.

ECMA-376 Part 1 §17.3.2.35 describes spacing between characters; §20.4.2.8 defines
inline drawing placement. The specification does not explicitly settle whether
the drawing placeholder counts as a spaced character. These controls establish
native reference compatibility without claiming an explicit specification contradiction.
