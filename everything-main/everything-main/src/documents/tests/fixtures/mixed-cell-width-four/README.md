# Four-column mixed-width controls

Original OOXML generated from Python standard-library code in
`tools/mixed_cell_width_four_fixture.py`, with fixed ZIP metadata. No corpus
content, font binaries or third-party implementation is included.

Six AutoFit cases cross first-column preferences of 2400/3600 twips and
absent/automatic merged headers or an explicit 6000-twip footer. The second
column prefers 1440 twips; the remaining two columns are automatic. Saved
grid widths are 3000/1800/600/600 twips. Short original labels and unique
cell fills permit independent geometric measurement.

The reference application exported the exact source read-only to `native.pdf`.
`tools/record_mixed_cell_width_preferences.py tests/fixtures/mixed-cell-width-four`
records PDFium fill bounds and source/cases/PDF hashes. Unit tests verify those
hashes; browser tests compare every body-cell x/width within 0.2pt and exercise
preservation, edit, undo and reopening. Source and browser exports pass XSD.

Relevant ECMA-376 Part 1: 17.4.49, 17.4.63, 17.4.71 and 17.18.87. This is
reference compatibility within the permitted layout-algorithm flexibility, not a
proven normative contradiction.
