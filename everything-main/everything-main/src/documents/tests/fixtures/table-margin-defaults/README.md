# Implicit table margin controls

These ten original minimal DOCX packages derive from the manually authored
column-flow wide-table control. No private corpus content or third-party
renderer is included. Regenerate sources with
`tools/table_margin_defaults_fixture.py`, export read-only in the reference application
with `tools/table_margin_defaults_native.ps1`, then bind native PDF coordinates
and COM padding observations using `tools/record_table_margin_defaults.py`.
References bind source and PDF SHA-256 hashes.

- No styles part or an empty styles part: 10-twip side padding.
- An empty unnamed default or custom table style: zero side padding.
- Explicit style margins: the authored 115 twips.
- Named built-in Normal Table: implicit 108-twip side padding and zero indent.
- Compatibility 14 controls distinguish grid alignment from explicit/resolved
  indentation; compatibility 15 aligns the outer border to the writing area.
- The borderless control separates implicit padding from border clearance.

ECMA-376 Part 1 §§17.4.34, 17.4.10 and 17.4.42 instead specify 115 twips
when no leading/trailing value exists in the style hierarchy. These controls
record the reference application's divergence. An arbitrary styleId is not a built-in style name.
The default attribute alone does not identify Normal Table.

The browser regression checks native text origins/baselines and pagination,
selection and hit testing, no-edit package preservation, text editing,
unchanged package parts, exact undo, and editable export/reopen.
