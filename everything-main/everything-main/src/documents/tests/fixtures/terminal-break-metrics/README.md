# Terminal page-break metrics

Eight original controls from `tools/terminal_break_metrics_fixture.py` use
the project's own OPC shell, Arial and no corpus content. The reference application exported the PDFs read-only. The generated source XML and all OPC
parts were checked against the exported input packages. The reference recorder
stores final package/PDF hashes and visible label page assignments/baselines.

Each page has 328 pt of writing height, with a preceding 312 pt exact-height
paragraph. A terminal page break with a 24 pt run and 4 pt paragraph mark
fits in the remaining space: both inherited and explicit run formatting yield
two pages. Swapping to a 24 pt mark yields three pages. A 12 pt text run or
space before the 24 pt break still fits, while visible 24 pt text does not.
Thus the terminal break run does not enlarge the line sharing its mark;
visible content and the mark still contribute their own metrics.

The split-mark compatibility and manual line-break controls distinguish those
behaviors from the default terminal-page-break rule. Browser checks compare
all visible baselines within 0.15 pt, x origins within 0.1 pt, and page
assignments exactly, then exercise editing, package preservation, undo and
reopening. Unit checks separately verify line and insertion-caret metrics.

ECMA-376 Part 1 §17.3.3.1 (`br`) and Part 4 §14.8.3.38
(`splitPgBreakAndParaMark`) specify break placement and the paragraph mark's
page. They do not explicitly define the relative font metrics in these cases;
this is observed native behavior, not a claimed contradiction of an explicit
font-size rule. Exact line-height, borders and overflowing terminal paragraphs
remain covered by the existing `terminal-break-fit` controls.
