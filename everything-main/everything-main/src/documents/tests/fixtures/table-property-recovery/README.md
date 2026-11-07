# Table property recovery controls

Original XML generated with Python's standard library, using the independently
authored image-recovery control as the surrounding document. Run
`python tools/table_property_recovery_fixture.py` to regenerate.

- `healthy.docx`: ordinary table, two valid images, styled text, numbering, header.
- `table-bidi.docx`: adds only `w:bidiVisual` to table properties.
- `row-revision.docx`: adds only an insertion revision to row properties.
- `cell-fit.docx`: adds only `w:tcFitText` to cell properties.
- `table-spacing.docx`: adds nonzero physical cell spacing, a recognized property
  whose active value is outside the current layout subset.
- `combined.docx`: combines the first three unsupported properties.
- `style-cell-fit.docx` and `conditional-cell-fit.docx`: declare fitted text in
  base/conditional table styles; the conditional region also has supported blue
  shading. Their `*-supported.docx` counterparts omit only the unsupported fit.

These are ECMA-376 Part 1 table/annotation constructs (§§17.4, 17.13), not malformed
packages. Before localized recovery, the importer fell back to table text and
dropped the table structure. The tests now require the table to survive.

Recovery should preserve the table and surrounding supported content in a
read-only approximation, report the unsupported property, and preserve the
original parts. Browser controls compare the retained layout and pixels with
the corresponding supported declarations, not with the reference application's rendering of the
unsupported feature. These controls do not assert that ignoring these properties
implements RTL table layout, tracked revisions, or fitted text. Full feature
support requires separate rendering/editing controls.
