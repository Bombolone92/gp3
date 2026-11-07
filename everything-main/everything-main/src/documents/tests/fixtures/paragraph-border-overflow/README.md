# Paragraph borders outside table cells

Original `tools/paragraph_border_overflow_fixture.py` authors three rows with
0pt, 5pt and 15pt paragraph indents. The 2pt blue border has 10pt text distance.
The reference application opens the exact input and exports the accompanying one-page PDF without
saving the DOCX. The first two frames have vertical borders outside the cell;
The reference application clips these away and clips horizontal borders to the cell edge. The third
frame's vertical borders lie inside the cell and remain visible. Adjacent gray
cells receive no blue ink. The previous layout guard rejected these documents.

The renderer keeps the full frame geometry and intersects border paint with
the physical cell fragment and any existing exact-row/nested-cell clipping.
Paragraph shading already clips to cells. Body-page border validation remains.
ECMA-376 Part 1 §§17.3.1.24 (pBdr), 17.4.66 (tc) provide the declarations; this
control establishes the reference application's cell clipping, without a claimed spec divergence.
Exact border offsets/thickness have existing PDF rasterization differences;
this regression verifies clipping, retained source and edit/undo behavior.
