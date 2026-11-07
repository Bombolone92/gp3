# Wide markup-compatibility traversal

`tools/canvas_large_drawing_fixture.py` builds an independent grouped drawing
using python-docx (MIT), lxml (BSD) and original PNG pixels. Ten nonpainting
paths contain 7,001 commands each. Every path is below the existing renderer's
10,000-command limit, while the combined descendants exceed JavaScript's
function-argument limit. No corpus artwork or source XML is distributed.

The old `activeDescendants` reproduced `RangeError: Maximum call stack size
exceeded` on this fixture in native Edge. The iterative traversal opens it
editable, preserving the selected branch, all paths, and original alternatives.
The reference application opened the same source and exported the two-page `native.pdf`
without saving. This establishes a valid wide drawing; it does not certify
every font metric or rasterization detail of the existing grouped-drawing probe.

The browser test checks all ten large paths, editable opening, surrounding
edits, export/reopen and byte-identical package restoration after undo. Unit
tests cover document order, nested choices/fallbacks, inactive branches, and
active compatibility errors. Reference clauses: ECMA-376 Part 3 §§7.5–7.7 and
§§9.3–9.4. The traversal fix does not expand supported namespaces or remove
existing unsupported-feature guards. No reference/spec divergence was identified.
