# Unequal section column flow

`tools/unequal_columns_fixture.py` independently authors four OPC documents. The columns are 72 and 180 pt wide, with a 36 pt gap. A long paragraph crosses columns and pages (`flow`), a continuous section balances both unequal columns (`balanced`), and an explicit column break advances the flow (`break`). The fourth declares three 72 pt columns but uses only the first two (`three`), verifying that no separator appears beside the unused third column. All declare separators.

The PDFs were exported from the reference application. `tools/record_unequal_columns.py` records text origins, baselines, wrapping, separator rectangles and source/PDF hashes. Native PDF text objects that split a word on one physical line are joined before comparison; paragraph and column boundaries remain separate.

The browser test compares every native line, each separator, caret hit-testing, and package preservation through no-edit export, text edits, undo and reopening. Separator rules occur only when a later column has content and extend to the deepest occupied line in the region. Native rectangle coordinates differ from exact source units by less than 0.2 pt.

Limits: tables in genuinely unequal-width columns, square-wrapped drawings in columns, and floating tables in columns retain explicit unsupported-layout guards. Top-and-bottom and unwrapped paragraph-anchored pictures are supported. Column declarations remain retained by the editing UI; the serializer preserves/produces explicit widths and separator flags instead of converting them to equal widths.
