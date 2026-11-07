# Table row starts at a page boundary

`tools/empty_table_fragment_fixture.py` independently authors nine controls.
No corpus content, fonts or third-party document engine is bundled. The
reference application exported `native.pdf`; `reference.json` records PDF
text origins and teal border raster rows at 96dpi. The source passes the official
ECMA-376 transitional schemas before capture.

Each case has 180pt of preceding text in a 200pt writing area. Cases 0–7 move
the complete row onto the second page. Case 8 retains first paragraphs on the
first page and splits the following paragraphs onto the second page.

| Case | Constraint |
| --- | --- |
| 0 | 14pt line and 24pt paragraph after-spacing, 1.5pt top border |
| 1 | Same with 6pt top cell margin |
| 2 | Same without a table border |
| 3 | Two 14pt lines with keepLines |
| 4 | Two paragraphs with keepNext |
| 5 | Only one cell requests 24pt after-spacing; both cells move |
| 6 | 30pt atLeast row height |
| 7 | 30pt exact row height |
| 8 | Both cells begin with a fitting 14pt paragraph; later paragraphs overflow |

The old engine retained border-only fragments in cases 0, 3 and 4, and incorrectly
started one cell in case 5. The fix moves the row when an owning cell postpones
its first nonvirtual line, respecting exact allocations and the fresh-page
overflow fallback. Case 8 guards real continuation borders. Unit tests also
remove after-spacing independently from the two cells, then export, reopen and
undo. The browser test checks the reference application's border placement on all eighteen pages,
typing, source-part preservation, undo and reopening.

Specification: ECMA-376 Part 1 §§17.4.6 (cantSplit), 17.4.80 (trHeight),
17.3.1.14–15 (keepLines/keepNext), 17.3.1.33 (spacing). Absence of cantSplit permits
splitting; it does not prescribe the precise first-content placement used here.
The native controls establish the reference application's boundary behavior; this is not a proven
contradiction of an explicit normative placement rule.
