# Native table indentation controls

`tools/legacy_table_indent_fixture.py` authors the original OOXML controls and
solid-blue PNG artwork. The reference application exported the unchanged inputs. The
companion recorder extracts image placement matrices from the PDFs and binds
each input and PDF by SHA-256. No application layout result supplies a reference.

The eleven fixture directories retain 101 horizontal placement controls:

- `legacy-table-indent`: 12 cases, compatibility 14, fixed layout, auto/dxa
  preferred widths, absent/zero/18pt direct indentation, 5.4/10.8pt cell margins.
- `legacy-table-indent-12` and `-15`: the same cases with only the compatibility
  mode changed.
- `legacy-table-origin`: eight cases, absent/left/center/right justification,
  borderless/4pt borders, and the default table style.
- `legacy-table-origin-no-styles`: the same source without a styles part.
- `legacy-table-origin-custom-style`: the same source with an empty custom
  default table style.
- `table-style-origin-properties`: five explicitly selected custom styles:
  empty, zero indent, zero margins, nonzero margins, and based on Normal Table.
- `legacy-table-indent-no-styles`: twelve controls distinguishing an omitted
  indent from explicit zero without a default table style.
- `legacy-table-origin-asymmetric`, `-no-styles-asymmetric`, and
  `-left-asymmetric`: 24 controls varying the leading and trailing margins
  independently, both with and without a default style.

In legacy modes a resolved `tblInd` positions the cell writing edge. Without
that declaration, the grid remains the reference. An empty custom style does
not change the reference; a zero indent does. A based-on chain inherits that
declaration. The built-in default Normal Table also supplies an implicit zero
indent when its stored declaration is omitted (additional private source/PDF
probe). Mode 15 retains the existing exterior-border placement behavior.

Legacy centered tables retain grid centering even with asymmetric margins.
Right justification uses the leading cell inset, not the trailing margin.
Left justification subtracts that inset when indentation is declared. Tests compare absolute image x
and width within 0.05pt, then exercise editing, exact undo and export/reopen.
This set does not certify all sparse/mixed-row margin combinations.

Relevant clauses: ECMA-376 Part 1 §§17.4.28 (`jc`), 17.4.50 (`tblInd`),
17.4.42 (`tblCellMar`), and §17.7.6 (table style inheritance). The difference
between an omitted indent and explicit zero is a native measured reference
behavior, not an authored document-specific displacement.
