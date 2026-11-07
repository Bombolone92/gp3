# Inactive text-upright flags

`tools/shape_upright_inactive_fixture.py` derives these original XML controls
from our own `shape-defaults.docx`. It adds `upright` values 0, false, 1 and true
to the first four shapes. The first three have no text box; the fourth has an
empty centered paragraph. The remaining shapes compare omitted/false values
with visible text. No corpus content is copied.

The reference application exported `native.pdf` without saving the DOCX. At 144 DPI its
entire raster is identical to `shape-defaults/native.pdf`: the declarations have
no visible effect in these cases. Regenerate the measured samples and hashes
with `tools/record_shape_defaults_reference.py --upright` after recapturing the native reference.

ECMA-376 Part 1 §21.1.2.1.1 defines upright as a boolean affecting text transforms,
defaulting to false. This control does not establish support for visible upright
text, which remains guarded. Paragraph decorations and fields are not discarded
to make a text box appear empty.

Browser checks cover native reference ink samples, body edits, retained shape XML, reopening
and exact package undo. Unit controls also reject malformed booleans and active
upright text; existing rotation regressions remain enabled.
