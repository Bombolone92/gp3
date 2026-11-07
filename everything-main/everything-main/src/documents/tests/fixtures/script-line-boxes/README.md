# Script text line-allocation controls

Original controls authored by `tools/script_line_boxes_fixture.py` using
python-docx (MIT) and lxml (BSD). The reference application produced
the PDF. No corpus content or separate font files are redistributed.

Thirty pages cover Arial, Calibri and Times New Roman; script-only and mixed
text; baseline, superscript, subscript, raised superscript and lowered
subscript. Runs are 20pt, paragraph marks and surrounding labels are 12pt,
automatic line spacing is single, and compatibility mode is 15.

The native reference demonstrates that the reference application allocates lines using the declared
font's metrics, independently of the smaller script ink. Explicit `position`
shifts those allocation metrics. A script-only line has the same total height
as its baseline control. With a positive shift and a smaller paragraph mark,
the mark can supply the descent; mixed full-size text retains its own descent.
This distinguishes line allocation from a glyph-sized box or a fixed extra gap.

The reference extractor pins DOCX/PDF hashes and records the surrounding
Before/After baselines plus the mixed line's untransformed Start baseline.
Browser comparisons require all of these baselines to agree within 0.2pt and
also verify editing, exact no-edit/undo package preservation and reopening.
They deliberately do not certify script glyph size/offset: those remain a
separate shared-renderer limitation documented by the text-transform controls.

Relevant standard: ECMA-376 Part 1 §17.3.2.42 (`vertAlign`), §17.3.2.24
(`position`), §17.3.1.33 (`spacing`). The standard describes script display
without changing declared run size; it does not prescribe this precise line
allocation algorithm. These controls establish the native compatibility behavior.
