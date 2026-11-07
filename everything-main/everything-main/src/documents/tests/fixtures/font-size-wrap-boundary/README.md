# Font-size wrap boundaries

Original OOXML from `tools/font_size_wrap_boundary_fixture.py`, using this
repository's original outline-control OPC shell. No corpus text, artwork or font
binaries are included. The reference application confirmed the exact source and
exported `native.pdf`. The reference script records source/PDF hashes, line breaks,
PDF font sizes and individual M origins.

Sixteen Arial paragraphs pair eight requested sizes (10, 10.5, 11, 12, 16.5, 17,
17.5 and 18pt) with narrow and wide text areas. Each paragraph has eight groups
of four M characters, 1pt character spacing, an explicit kerning setting and
22pt exact line spacing. Narrow widths were chosen near measured browser text
advances and then frozen in the generator; expected wraps come from the reference application.

The reference application wraps the 11pt and 17pt narrow rows, producing 18 lines across two pages.
The original app produced 16 lines on one page. The corrected measurement now
matches every line and page, including native first origins/baselines, with
editing, original-part preservation, exact undo and editable reopen covered.

`tools/record_font_wrap_thresholds.ps1` opens an owned read-only reference application instance,
verifies the source, varies paragraph indents in memory and records the minimum
whole-twip width for each size. It closes without saving. The recorded widths
match the installed Arial design advances rounded up to a twip: M=1706 and
space=569 at 2048 units/em, plus 39pt of character spacing. These are measured
font facts, not bundled font data or a family-specific runtime adjustment.

The browser instead measured fractional CSS em sizes slightly too narrowly.
For example, the 17pt line measured 525.0748pt instead of the design advance
525.2183pt; the reference application requires 525.25pt. The runtime measures just above the next
hundredth of a CSS pixel, then scales the result back, including absolute
character/word spacing. A small relative epsilon handles float precision at
large em sizes. Kerning decisions retain the original threshold. Stored sizes,
painted sizes and line-box metrics remain unchanged. One shaping call remains
one shaping call. Integral-hundredth sizes retain their previous measurement.

PDF font-size quantization was a rejected explanation: the 10.5pt and 16.5pt
rows emit larger PDF sizes but do not wrap. PDF-painted advances also do not
directly establish the reference application's line-breaking width. The regression therefore checks
native paragraph boundaries and the separately measured minimum widths.

Relevant OOXML: ECMA-376 Part 1 sections 17.3.2.38 (sz), 17.3.2.35 (spacing),
17.3.2.19 (kern), 17.3.1.12 (ind), and 17.3.1.33 (paragraph spacing).
No normative contradiction is claimed. This arose while investigating the
private Arial diagnostic for corpus #133; its two closing paragraphs now wrap
as the reference application does. The original corpus document still needs its unavailable Posterama font.

`tools/audit_font_wrap_print_origins.py` independently re-extracts the 512 M
origins from this hash-bound PDF and checks the source run properties and eight
native minimum widths. Printed per-character origins differ from declared-size
design advances even where the native line-breaking thresholds match exactly;
this is not evidence for changing model font sizes or layout widths.
