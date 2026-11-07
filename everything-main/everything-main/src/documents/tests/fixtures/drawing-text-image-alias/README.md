# Alias image parts in alternate drawing text

`tools/drawing_text_image_alias_fixture.py` constructs these packages from the
original authored picture-control generator. `control.docx` contains equivalent
WPS/VML text frames with a PNG/SVG picture. Each branch uses different relationship
IDs and different media part names, but its declared types and image bytes are
identical. Two grouped neighbors retain the original picture controls.
`header.docx` places the alternate frame in a header with its own relationships.
`controlled.docx` wraps the picture in a persistent inline content control; edits
to neighboring text must retain its untouched run metadata in both branches.
All content and the red-square PNG/SVG are original; no corpus artwork, font
programs or native saved output are included.

ECMA-376 Part 2 fifth edition (2021) §§6.5.2–6.5.3 define relationship ownership
and markup. Part 1 §§15.2.14 (Image Part), 20.1.8.13 (blip), and 17.3.3.9
(drawing) describe the referenced image resources. Matching an image's source
identity now resolves its owning part's internal image relationship and declared
content type, and compares complete resource bytes. Different references are
never rewritten to the comparison token, deduplicated or removed from the package.
This is application editing support, not a claimed reference/spec divergence.

The regression verifies that raw reference matching guards the authored control,
while resource-aware matching permits a rich draft edit. Text edits, image move,
resize, reflection and description changes retain each branch's original PNG/SVG
references. Save/reopen, exact shared undo/redo, unchanged package parts, header
ownership and actual browser draft Apply/Cancel interactions are covered. Negative
controls retain guards for different bytes/types, absent/duplicate/external or
non-image relationships, and a header reference that cannot resolve locally.
SVG resources supported by the renderer contain only local/embedded resources;
external SVG resources remain outside the supported decoder subset.

The source-correlation timing isolates source matching from rendering and layout;
it does not certify whole-editor performance or all corpus visual fidelity.
Direct text selection inside transformed drawings remains unfinished.
