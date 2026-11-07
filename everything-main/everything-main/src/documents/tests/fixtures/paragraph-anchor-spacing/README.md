# Paragraph-relative anchor origin

`tools/paragraph_anchor_fixture.py` builds twelve independent OOXML controls
using the project's original blue PNG anchor fixture. The reference application
exported the PDF without saving the DOCX. `record_paragraph_anchor.py` reads
image transformation matrices from that PDF and records source/reference hashes.

The cases vary zero/12/36pt before-spacing, preceding 0/6/24pt after-spacing,
empty versus visible anchor paragraphs, contextual spacing, positive/negative
offsets, and a top border with spacing. Each case occupies a separate section.

The reference application places a paragraph-relative drawing before the current paragraph's
contribution to the collapsed spacing gap and its top-border clearance. The
previous paragraph's effective after-spacing remains part of the origin:
after6/before24 positions the image 6pt after the previous 12pt line, while
after24/before12 positions it 24pt after that line. Text still receives the full
collapsed gap. Page/margin-relative anchors keep their independent origin.

Browser checks compare painted blue pixels with the reference application's PDF coordinates, select
and delete/undo the drawing at its corrected location, edit body text, export,
reopen, and restore exact OPC parts on undo. Unit checks verify geometry and
hit testing separately from native font measurement. These controls establish
unwrapped anchors; complex wrapping interactions and joined paragraph borders
need additional controls before claiming full fidelity for those combinations.
