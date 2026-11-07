# Drawing hyperlink precedence

`tools/drawing_hyperlink_fixture.py` creates four original blue/orange picture
controls from the repository's original inline-picture scaffold: an outer
`wp:docPr/a:hlinkClick`, an inner `pic:cNvPr/a:hlinkClick`, conflicting links
at both levels, and neither. The only destinations are example.com URLs.

The committed source was opened read-only with exact FullName verification in
the reference application. Its PDF has two hyperlink annotations, both using the outer
destination. The reference application's Hyperlinks collection independently reports the same two
active outer links; it does not expose the inner-only link. Preserve inner
metadata without activating it, including after editing the outer destination.
The reference JSON records source/PDF hashes and independent annotation frames.

Relevant ECMA-376 Part 1 clauses: §§20.4.2.5 (`docPr`), 20.2.2.3 (`cNvPr`),
21.1.2.3.5 (`hlinkClick`), and the CT_NonVisualDrawingProps/CT_Hyperlink schemas
in §A.4.1. The schema permits hyperlinks at both levels. The reference application's observed
activation behavior is recorded here; this control alone does not establish
a normative precedence rule or support for links inside grouped subshapes.

Tests check active image hit regions, Ctrl/Cmd-click, the existing keyboard
link dialog, independent shared relationships, removal, undo, retained inner
metadata, package preservation and export/reopen. New-window external links
use the editor's existing checked URL and noopener/noreferrer behavior.


`inner-frames.docx` is a second original control, generated with
`tools/drawing_hyperlink_fixture.py --inner-frames`. Its inner-only picture has
literal quotes in the target-frame value (`"_blank"`), and its conflicting inner
link uses `namedFrame`. The reference application still exports exactly two outer-link PDF
annotations. The source, PDF and hashed annotation reference are retained.
The target-frame field is a string; neither value is a schema error. Inner
frame names are preserved without being passed to an opener. Active outer
frames keep the existing supported-frame restriction. Unit and browser checks
cover retained metadata, inactive clicks, editing, undo and reopening.
