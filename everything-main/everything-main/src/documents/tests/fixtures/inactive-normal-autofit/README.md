# Normal autofit without a text box

`tools/inactive_normal_autofit_fixture.py` creates eight original controls from
the project's shape-defaults shell, removes their text boxes and supplies
`a:normAutofit` with default, integer and percentage-string attributes. No corpus
artwork or external fonts are included. The reference application exported the
exact source to `native.pdf`; `tools/record_shape_defaults_reference.py
--inactive-normal-autofit` records independent ink samples and source/PDF hashes.

With no `wps:txbx`, these settings have no text or line spacing to scale. The
importer validates CT_TextNormalAutofit and the mutually exclusive EG_TextAutofit
choice, preserving the XML without adding layout behavior. Integer fontScale
uses 1000..100000; lnSpcReduction uses 0..13200000; their percentage-string union
members follow the published ST_Percentage syntax. Active normal text fitting
remains guarded, including a text box containing empty paragraphs.

Both the new control and existing shape-defaults browser cases match native ink
and pass editing/export/reopen, unchanged shape markup and exact undo. Sources,
four browser exports and the original birthday-card exports pass schema checks.
Production build and license checks pass. No reference/spec divergence was observed
for shapes without text boxes.
