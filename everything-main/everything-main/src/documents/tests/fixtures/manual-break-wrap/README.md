# Manual line breaks with floating-picture wrapping

Original OPC/XML controls generated with Python's standard library by
`tools/manual_break_wrap_fixture.py`. The PNG comes from an original repository
fixture builder; no corpus artwork or third-party document engine is used.

Body, header and footer pairs contain two affected pictures around healthy
rich text, a table and an ordinary wrapped picture. Each matched pair differs
only in the affected pictures' `wrapTopAndBottom` versus `wrapNone` elements.
Manual breaks, dimensions, signed positions, stacking and all healthy content
are unchanged. Before recovery, the body source reached whole-document text
preview, losing all three floating pictures, its table and decoded images.
Page-story sources lost all three story pictures and healthy story content.

The September 30 read-only view omitted wrapping only on pictures anchored to
paragraphs with manual line breaks. It retained their positions and rich content,
while normal wrapping in other paragraphs remained active. The banner identified
the affected paragraphs/pictures and warned that text could overlap them.
That was an approximation, not complete wrapping support. Page/column breaks
remain separate unsupported cases; unexpected measurement errors still propagate.

Relevant ECMA-376 Part 1 fifth-edition clauses: §17.3.3.1 (`br`), §17.3.3.4
(`cr`), §20.4.2.3 (`anchor`), §20.4.2.15 (`wrapNone`) and §20.4.2.20
(`wrapTopAndBottom`). Simple line breaks and floating wrapping are valid OOXML;
the rejected combination is an engine limitation. No reference/spec divergence is
claimed by that recovery change. Native controls added on October 2 now enable
ordinary manual breaks with supported body/header/footer picture wrapping. See
`../manual-break-wrapping/README.md` for native evidence and the split-row
reference/spec divergence. Wrapping inside table cells remains an approximation.

Current browser checks retain rich body/story content at 75% and 100%, require
real wrapping to differ from the no-wrap companion, permit text editing, and
preserve every original package part after undo. Unit checks preserve source
models/package parts, keep supported wrapping in other read-only previews,
recover unsupported cell wrapping and propagate unrelated errors. The older
controls omit explicit rich-run fonts and therefore are not native font-layout
references; the newer native controls declare their fonts explicitly.
