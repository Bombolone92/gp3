# Reference Range device captures

Sixteen EMFs were captured from a byte-identical scratch copy of the original
manually authored `../control.docx`, opened and exact-path confirmed using the
reference-opening helper. The reference application retained `Saved=true` before/after the capture;
the source hash did not change. The owned scratch document was closed without
saving. No other document or application window was closed.

Each capture comes from that paragraph's text Range, excluding its paragraph
mark. The reference application additionally emits an Aptos space marker; it is excluded from all
origin comparisons. These files contain text/font descriptors and advance
records, not embedded font programs. No font was installed, copied or bundled.
All source text is the original independent M/space control, not corpus text.
`capture.json` binds every EMF and the original DOCX.

**Range capture reflows text at a fixed width.** It does not preserve source
paragraph widths, pagination or all line breaks. These EMFs must not replace
the native page PDF or minimum-width reference. The audit checks the bounded
record inventory, zero origin, baseline alignment, identity transforms, 600dpi
EMF+ header and horizontal frame/window extent before converting advances to
points. It compares matching first-line prefixes relative to their first M.
It does not assert physical screen glyph outlines or an arbitrary EMF mapping.

Inspect with `python tools/audit_font_wrap_device_origins.py --output result.json`
from the repository root. To recapture, copy `../control.docx` into a fresh
scratch directory, open that exact copy with the documented reference-opening helper, then
run `tools/capture_font_wrap_device_origins.ps1 -ControlRoot <scratch-directory>`.
Use `-CloseOwnedDocument` only when that copy was opened for your capture.
The recorder writes EMFs/metadata beside the scratch source and never saves it.
Do not overwrite committed references until the new provenance is verified.
