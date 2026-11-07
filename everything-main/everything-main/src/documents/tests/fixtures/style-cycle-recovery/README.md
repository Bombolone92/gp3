# Cyclic style inheritance recovery

Generate with `python tools/style_cycle_recovery_fixture.py`. These original
OOXML packages extend the independent mixed-content style-identity control;
they contain two pictures, two tables, a header, numbering, document defaults,
styled text and direct formatting. No corpus artwork or font files are copied.

Eight cases cover paragraph, character, table and default styles, a self-cycle,
a style derived from a cycle, simultaneous cycles, and companion table styles.
Each `*-control.docx` differs only by omitting the links inside the cycles.
The derived style's valid link remains in both versions. All sixteen packages
pass 66 XML schema checks. Schema acceptance does not resolve inheritance cycles.

ECMA-376 Part 1 §17.7.4.3 describes `basedOn` inheritance, missing-base handling,
type compatibility and the exclusion of numbering-style inheritance. See also
[Open XML SDK specification remarks](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.basedon).
This is an explicitly disclosed read-only recovery policy, not a claim that the reference application
repairs cycles this way or an implementation of full editable cyclic inheritance.

Strict editing still rejects used cycles. The private preview XML removes all
edges inside each cycle, preserving own declarations, descendant edges, defaults,
healthy styles and original package bytes. Both table and paragraph/run readers
consume this view; the companion view remains lazy and separate. The banner
identifies the part, style IDs and omitted links. Edited export stays unavailable.

Unit controls compare recovered formatting against each matched control and
verify original bytes, strict rejection, typed/missing links, numbering-style
exclusion, declaration-order independence, multiple cycles and clone isolation.
Browser controls compare full-page pixels and body/header geometry, assert both
tables and pictures survive, and verify the original download and issue banner.
Existing character-style browser tests cover editing, undo and exported reopen.

The comparison against `bab73552` shows that the combined control previously
lost its second table and affected style formatting. The candidate exactly
matches its control. The healthy control and all three pages of corpus #353 are
pixel-identical across the change; #353's decorative page borders remain partial.
