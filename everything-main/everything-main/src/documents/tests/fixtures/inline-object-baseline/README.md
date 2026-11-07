# Inline object baseline references

The original three DOCX files were hand-authored as original OPC/XML packages, using
the minimal package scaffold from `section-before-spacing.docx`. Black rectangles
use either an original DrawingML rectangle or an original solid-color PNG. No
corpus content or third-party document engine was used.

The PDFs were exported by the reference application. The JSON files record source
and PDF SHA-256 hashes, case definitions, and PDFium path/image bounds in points
from the page top. The edge fixture's drawing IDs were made unique and its PDF
recaptured. All source packages pass the transitional/extension schemas.

- `inline-object-baseline`: 16 cases distinguish shapes/pictures, Times New
  Roman/Arial, isolated objects/visible adjacent text, and zero/0.3pt bottom
  effect extents.
- `inline-object-edge`: 12 cases cover 7.2/20/72pt objects, spaces, empty runs,
  multiple objects, exact/atLeast/double spacing, and paragraph-mark/run sizes.
- `inline-object-exact`: 10 controls vary exact line height and paragraph-mark
  size, include a space/visible text, and use oversized objects.

Native reference observations: an image-only line (including whitespace) uses the invisible
mark as a minimum height without appending its descender to the object. Short
objects align to the bottom of that natural line; tall objects determine its
height. Multiple automatic spacing retains the natural baseline and adds space
below it. At-least spacing bottom-aligns the object; exact spacing puts the
baseline at 80% of the assigned height. Mixed visible text retains a text baseline.

ECMA-376 Part 1 §§20.4.2.8 (`inline`), 17.3.1.29 (paragraph-mark `rPr`),
17.3.1.33 (`spacing`), and 17.3.1.39 (`textAlignment`) apply. The last clause
leaves automatic vertical alignment to the consumer. These are measured reference
compatibility details, not a demonstrated contradiction of a numeric rule.

Two further variants of the edge file retain native references for compatibility
modes 14 and 15. The five documents contain 62 cases. Browser assertions match
61; the exact-spacing `text` control retains a separate existing text-baseline
discrepancy and is excluded from that claim. Legacy/default mode 12 and mode 14
use the paragraph mark's font as the image-only minimum. Mode 15 uses the inline
image run's font, so enlarging the mark alone no longer raises the line height.

The image-only correction exposed an independent missing-defaults error in the
existing `header-drawings-footer-blank.docx` control. The reference application's final empty paragraph
uses multiple spacing (278/240), not single spacing. The old extra descender had
partly masked the difference. The accompanying default-paragraph-spacing controls
and importer correction restore that footer's measured reference position without
special-casing the document or overriding explicit paragraph defaults.
