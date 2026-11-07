# Conditional table-row header controls

`tools/conditional_row_header_fixture.py` writes original OOXML using the
minimal package shell of the original noWrap fixture. The reference
application exported `native.pdf` (15 pages) without saving the source.
`tools/record_conditional_row_header.py` extracts label page membership,
colors and baselines from that PDF and records source/PDF SHA-256 hashes.

Ten cases cover first-row, first-column and horizontal-band header flags;
derived-style false; style versus direct repeated headers; direct false;
disabled first-row look; nonleading direct headers; and multipage banding.
All labels, text and colored cells are original.

ECMA-376 Part 1 §§17.7.6.10 (conditional trPr), 17.4.49 (tblHeader), and
17.7.6 (table styles) apply. Conditional header flags resolve against the
base/direct row regions once, then text/cell regions use the effective flags.
Direct flags and editor changes override inherited flags. Repeated display
rows are not serialized as duplicate source rows.

Reference-specific distinction: enabled firstRow formatting includes row zero and
consecutive following header-marked rows, even when row zero is unmarked.
Actual page repetition still requires a leading contiguous marked run.
The nonleading-direct and band controls independently expose this distinction;
the repetition rule in §17.4.49 alone does not describe formatting membership.

The browser test compares every label's page, color and position within 0.8pt
of the reference application, then edits, exports, reopens and undoes to exact original OPC parts.
Unit tests cover stable refresh, inherited-header editing and row insertion,
plus malformed and unsupported conditional row markup. Other regional row
properties remain unsupported; these controls do not establish their behavior.
