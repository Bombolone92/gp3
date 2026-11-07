# Karla availability and layout control

`tools/karla_family_fixture.py` independently generates this original, deterministic
DOCX. It contains 16 right-aligned paragraphs: regular, bold, italic, and bold
italic at 10/14 pt, each with explicit kerning thresholds 0/2 half-points.
Paragraph marks use the same formatting. No corpus text or embedded fonts are used.

`native.pdf` was exported from the exact control with the reference application
using `tools/export-reference.ps1`. `tools/record_karla_family.py` records
PDF character origins, baselines, font resource names, and input hashes.
The PDF uses Karla 2.002 Regular/Bold; italic runs use a 0.3333 shear of the
upright resources. Upstream's separately designed italic faces have different
advances and are not included in the reviewed asset set.

The browser regression checks all 16 line starts and baselines within 0.2 pt,
lazy same-origin loading, editable import, unchanged ZIP parts, insertion,
unrelated-part preservation, exact undo, and reopening the edited export.
Observed maximum differences were 0.175 pt horizontally and 0.160 pt vertically.
Full-page visual review was performed. This is not an ink/pixel identity claim:
browser synthetic italic slant and rasterization can differ from the reference application.

Installed families retain priority. The two upstream OFL assets are used only
when Karla is unavailable; they are not installed or embedded in DOCX exports.
Source provenance and corresponding editable font sources are recorded in
`public/fonts/PROVENANCE.md`.
