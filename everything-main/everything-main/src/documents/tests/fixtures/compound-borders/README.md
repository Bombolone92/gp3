# Thin/thick large-gap border reference controls

Original DOCX controls constructed as OPC/XML with
`tools/canvas_compound_border_fixture.py`. They reuse only the independently
authored inline-object-baseline package scaffold, not corpus content or another
document engine. The reference application exported the retained PDFs on 2026-09-18.

The controls cover paragraph and table top/left/bottom/right borders at sizes
8, 24, 48, 96 eighth-points; `--edges` covers sizes 0, 2, 11, 12, 13, 17.
PDF vector bounds establish fixed 1.44pt thick and 0.72pt thin strokes. The
measured gaps are respectively 0.96, 3, 6, 12pt and 0.12, 0.24, 1.32, 1.44,
1.56, 2.04pt. Size controls the gap rather than either stroke. The reference application quantizes
that gap down to 600dpi units, with a minimum of one unit even at size zero.

The `--frame` generator option produces the paired frame controls.
Without `frame`, the thick stroke is on the low-coordinate side of both axes
(top/left of each band), including bottom/right borders. The paired frame
control changes only `w:frame="1"`: The reference application reverses bottom/right bands, retaining
top/left corner bands and all geometry. The straight left table-edge body also
reverses, unlike the left paragraph edge; the follow-up isolated flag controls
in `../border-corners` document this distinction. `frame-paths.json` records
both vector sets.
The high-width, exact-height table controls intentionally demonstrate borders
encroaching on text; they are not aesthetically designed templates.

ECMA-376 Part 1 §17.18.2's description is corrected by
[MS-OI29500 §2.1.528](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/923382bf-235a-4f4a-b9df-d5a0f8b2ead8):
The reference application uses two strokes for this style. The quantitative metrics above come from
the independent controls, not that qualitative description. Shared-edge weight
uses border number 17 from
[MS-OI29500 §2.1.169](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/7c791c5d-44c3-4fe8-abdd-8f136761bb93).

`native-paths.json` records the controls source/PDF SHA-256 and PDF path bounds.
Edges source SHA-256:
`1074f2d26c4d3821d05e2d5ee053362e76d4bc10d00c41f43cf4f0e3a5f9845c`.
Edges PDF SHA-256:
`4ee5104f0b1101c34043f39a48b126245748f23409e3eb0e7cffcb7ad5f7299f`.
Frame source SHA-256:
`42f17361cc4d7a45942cc2f5a7f4ba2591d2150782df433dceac4d9dca3a21dc`.
Frame PDF SHA-256:
`7c67bf1d996d51a78aa8ef57a35efbc3de9e7bd3b8b78ab30a8dba24e2a94011`.
