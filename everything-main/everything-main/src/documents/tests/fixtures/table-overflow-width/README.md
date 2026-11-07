# Preferred table widths beyond the writing area

`tools/table_overflow_width_fixture.py` authors twelve controls in both legacy
and compatibility-mode-15 DOCX files using original OPC/XML. The reference application
exported each twelve-page PDF without saving the source. The recorder extracts
the blue/orange cell fill rectangles directly from PDF drawing operators and
binds source/PDF SHA-256 hashes; it does not use application output.

Cases cover absolute widths larger than the writing area, a fitting width,
fixed versus AutoFit layout, 110% and 100% widths, automatic width with a large
grid, left/center/right alignment, indentation, a nested table wider than its
parent, and conflicting table/cell width preferences. Both compatibility modes
give the same measurements. Explicit preferred widths extend into margins or
beyond the parent cell; automatic widths still shrink to available space.

Browser checks compare both cell positions and widths within 0.5pt and sample
actual painted fill coverage, including portions outside the writing area and
parent cell. The tolerance accommodates the reference application's sub-point allocation/rounding
in the shrinking controls (up to 0.29pt), while the previously lost excess
width is 36pt or more. Checks repeat after editing and reopening; undo restores
all source package entries exactly. Unit checks preserve table declarations
while allowing import-local internal IDs to be regenerated.

References: ECMA-376 Part 1 §§17.4.63, 17.4.53 and 17.18.87. The algorithm's
page-width condition concerns overriding preferences to accommodate content;
it does not require unconditionally shrinking an already wider preferred table.
These controls establish the implemented native behavior without a new claimed
normative divergence. Tables beyond the physical page still retain the existing
explicit layout restriction.
