# Paragraph script size controls

Six original authored pages put a paragraph before the same nested table. Empty
and Latin `i` paragraphs use Latin 10pt with complex-script sizes 10, 10.5 and
18pt. Generate with `tools/empty_paragraph_script_size_fixture.py`.

The reference application draws all six prefix baselines at logical (60,141), with Arial
height -83. The following label baseline is (151,304), 142 logical units below
its table border center. Unforced complex-script size does not enlarge these
Latin paragraph lines. This is negative evidence against a maximum-script-size
metric correction, not proof of corpus equivalence.

Native EMFs are detached table-range captures from the exact helper-opened saved
source moniker. Source hashes and saved state were checked before and after.
Moniker binding does not establish identity with the reference application instance.
There is no inferred page translation, embedded font program or corpus artwork.
The recorder verifies mapping, text, font descriptors and border geometry;
the source regenerates byte-for-byte without the reference application.
