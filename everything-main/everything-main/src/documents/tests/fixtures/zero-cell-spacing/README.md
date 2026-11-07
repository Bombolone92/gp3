# Zero and ignored table cell spacing

`tools/zero_cell_spacing_fixture.py` independently authors ten controls with
ordinary and nested tables: omitted spacing, row zero/default-unit/auto/pct/nil,
table zero/auto/pct, and row-exception zero. The reference application produces identical
colored table bounds for every case. The reference extractor records those
bounds and the source/PDF hashes without importing renderer code.

ECMA-376 Part 1 sections 17.4.43–45 define row, exception and table cell spacing.
They explicitly ignore pct and auto values. Sections 17.4.87 and 17.18.90 define
the measurement syntax and nil width. Explicit measurement units override a
contradictory type. Zero physical spacing is a no-op; actual nonzero physical
gaps still require unsupported layout and border behavior and reject editable
import. Ignored values receive lexical validation without an irrelevant layout
range limit. Tiny nonzero physical gaps are not rounded down to zero.

The original declarations remain in the table/row XML shells and survive
surrounding and nested-cell edits, export/reopen and exact undo. No standard/reference
divergence was found for these controls. Supporting nonzero cell gaps remains
separate work; accepting no-op declarations does not claim that feature.
