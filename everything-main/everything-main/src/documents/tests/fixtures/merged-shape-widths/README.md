# Merged headings and inline shape column pressure

`tools/merged_shape_widths_fixture.py` creates six original tables directly as
OOXML, with no corpus artwork or external media. Each table has a 240-point
preferred width and a 45/150/45-point grid. A merged heading contains either
no text or thirty Arial 12-point underscores. The next two rows put a blue
inline rectangle at opposite ends, merging the other two cells. Rectangle
widths are 30, 42 and 60 points; side margins are 5.75 points.

The reference application exported the exact source read-only. Green border
centerlines measured independently from its PDF give approximately
45/150/45, 53.5/133/53.5 and 71.5/97/71.5 points. Adding the heading does not
change those allocations. The JSON reference binds the source and PDF hashes.
Regenerate the DOCX, run `tools/export-reference.ps1`, then run
`tools/record_merged_shape_widths.py` to update the evidence.

ECMA-376 Part 1 §17.18.87 describes AutoFit; §17.4.17 describes gridSpan and
§17.4.71 describes preferred cell widths. A merged minimum constrains the
combined span. It must not become a last-column minimum when the resolved
preferred span already accommodates it. This is an engine allocation error,
not evidence of a reference/specification divergence. Spans that exceed their
preferred width retain their existing content-pressure allocation.

The browser test compares all eighteen native column widths within 0.1 point,
edits a merged heading, checks untouched package parts, exact undo and edited
reopening. The unit tests also cover reversed row order and immutable inputs.
Existing crossing-span cases that previously matched the reference application remain strict
assertions even where other pages have expected fidelity failures.
