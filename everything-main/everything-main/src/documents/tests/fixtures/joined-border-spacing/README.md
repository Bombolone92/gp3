# Joined paragraph border spacing

`tools/joined_border_spacing_fixture.py` creates original OPC/XML controls with
Arial 10pt text on exact 12pt lines. Each DOCX was confirmed open by its full
path in the reference application, exported as PDF and closed without saving.
`reference.json` records the PDF hashes and text baselines in points from
the page top. Compatibility modes 12 and 15 each have eight reference pages.

The cases cover body and cell paragraphs with identical borders, keep-next,
a 2pt between border, and a changed bottom-border distance that breaks joining.
The top border is 0.25pt with 10pt text distance; the bottom border has 3pt
distance, changed to 18pt on the final paragraph in the differing-border case.
Joined lines advance 12pt, whether or not keep-next is enabled. With a between
border they advance approximately 14pt. Differing borders retain both touching
edge clearances. The body and cell cases have the same measured baselines.

ECMA-376 Part 1 §§17.3.1.5 (`between`), 17.3.1.24 (`pBdr`),
17.3.1.42 (`top`) and 17.3.1.7 (`bottom`) describe joined border sets. The reference application's
behavior agrees with this rule; no reference/spec divergence is claimed. The bug
was a pagination boundary adjustment being applied to ordinary paragraphs,
adding top clearance after the joined-border calculation had removed it.

Unit tests reproduce the pre-fix 10.28pt baseline error against the reference application, check
all recorded relative baselines, edit grouping, export/reopen, exact undo and
top clearance after an explicit page break. Browser tests independently measure
painted text baselines and verify no-edit/edit/undo package preservation.
Sub-point PDF rounding is tolerated (0.35pt); page counts are exact.
