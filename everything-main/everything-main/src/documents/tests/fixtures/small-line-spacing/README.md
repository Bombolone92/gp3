# Small point line spacing

Original XML produced by tools/small_line_spacing_fixture.py. The reference application exported the one-page PDF without saving the DOCX. No external artwork. JSON records source/reference hashes and the advance between the PDF baselines of Ag and Bg for each of twelve cells. Compare relative line advances rather than claiming full table-spacing equivalence. The original uses Arial 12pt; native reference checks require that font.

Minimum values 0, 0.05, 1, 5.95 and 6pt retain natural line height; 24pt expands it. Positive exact values use the specified height and clipping. The reference application renders exact 0pt at natural height, an exception to a literal exact-height interpretation. Its PDF coordinates round the 0.05pt case to a zero baseline difference, within the test's 0.15pt tolerance. Automatic zero multiples remain a separate existing behavior.
