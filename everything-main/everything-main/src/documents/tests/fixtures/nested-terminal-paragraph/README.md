# Empty terminal paragraph after a nested table

`tools/nested_terminal_paragraph_fixture.py` manually authors five original
body-table controls. The reference application exported `native.pdf` without
saving the DOCX. `tools/reviewed_font_reference.py nested-terminal-paragraph`
records independent baselines and source/PDF hashes.

The reference application gives an empty final paragraph immediately following a nested table zero
layout height. Both its exact line height and before/after spacing are ignored:
the 18pt control and the 36pt control with two 8pt gaps both advance just 36pt
from the preceding label to the following label. A visible ending advances
54pt, two empty ending paragraphs advance 72pt, and a spaces-only ending
advances 54pt. Thus only a directly adjacent, terminal, truly empty paragraph
collapses. This is a general cell-content rule, not a footer-specific offset.

ECMA-376 Part 1 §17.4.65 (printed pp.457–458, PDF pp.467–468) allows nested
tables and paragraphs within a cell and requires at least one block-level
element. §17.3.1.33 specifies paragraph/line spacing but does not state this
suppression exception. The reference application behavior differs from applying ordinary
spacing to that paragraph; these manually authored controls document the
exception. The renderer retains the paragraph, its insertion position and
all stored formatting. Typing restores its ordinary height; undo restores the
collapsed layout and exact package bytes. Whitespace and additional paragraphs
are not collapsed. Row minimums, borders and cell margins remain applicable.

The browser oracle checks all printed text and baselines within 0.15pt, no-edit
package equality, body editing, unrelated-part preservation, undo and reopen.
Unit controls additionally verify insertion into the collapsed paragraph,
restoration of its stored spacing and the resulting geometry after reopening.

Both full reference/browser pages were visually inspected. Validation: 61 unit
tests, eight browser cases (including six nested clipping comparisons), 20
XML source/export checks and production build/license checks pass. The
maximum text-baseline error in this control is 0.05pt.
