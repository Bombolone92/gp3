# Manual line-break font metrics

`tools/manual_break_metrics_fixture.py` independently authors 20 controls in
compatibility modes 14 and 15. The text uses Verdana 10pt bold; the manual
break has inherited Calibri 12pt or explicit Calibri/Verdana 10/12/24pt.
Controls include empty, spaces-only, NBSP, trailing and repeated breaks, and
a table cell. Paragraph marks deliberately use a different size. The
reference application exported each source read-only; `tools/manual_break_metrics_reference.py`
pins source/PDF hashes and all First/Second/After glyph baselines.

The reference application excludes the break font from a line containing text, including NBSP.
Empty and spaces-only break lines use the break font. Repeated/trailing
breaks retain the separate blank-line and terminal-paragraph-mark metrics.
The browser verifies all captured baselines within 0.15pt in both modes,
and exercises deletion immediately before a large-font break, export,
untouched-part preservation, exact undo and reopening. Unit tests verify
that deleting the text activates the retained break metrics and restores
line/caret geometry on undo.

The additional `page-break-large-space.docx` uses the independently authored
terminal-break control's OPC shell: a 36pt space run precedes a terminal page
break with a 4pt paragraph mark, with only 16pt left on the page. The reference application renders
two pages, proving the space run does not require its own line height. The
browser checks this page count. This strengthens the older 12pt-space control,
which could fit with either metric rule, and corrects its unit expectation.

ECMA-376 Part 1 §17.3.3.1 (`br`), §17.3.1.29 (paragraph-mark `rPr`) and
§17.3.1.33 (`spacing`) describe break placement and formatting. They do not
explicitly prescribe the invisible break's font contribution to nonempty
line height. These controls document observed reference behavior, rather than
claiming a contradiction of an explicit normative font-metric rule.
Part 4 §14.8.3.38 covers terminal page-break/paragraph-mark placement.
Page/column-break layout rules and source run formatting are retained.

The affected original email-signature gallery retains all 165 matching text
lines and its three pages. Two baseline errors shrink below 0.15pt; its
remaining website baseline discrepancy of 0.992pt is not fixed here.
