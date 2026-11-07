# Shadow obscuration metadata

The independent generator `tools/canvas_shadow_obscured_fixture.py` uses the
original grouped-drawing probe, adding a normal inline picture and flags to
picture and WPS shape properties. No corpus artwork is distributed. Dependencies
are python-docx (MIT), lxml (BSD) and the Python standard library.

The reference application exported the source without saving to `native.pdf`. The paired
`native-without-flag.pdf` removes only the extension lists containing these flags
from a temporary copy. Both pages render identically at 108 dpi, including with
omitted, true, false, 0 and 1 values. SHA-256 of the RGB raster bytes per page:

- `6ecd5d06337cc47b4e87e57b6e0c46e00b70db301952eb81444e8776a4ad2cc7`
- `22de9d9f751f07c490bfb16af337c289dcffae8b8e8ebe5176539cbc0683f1f9`

This establishes that the flag does not change these shadow-free scenes, not
complete geometry equivalence with the native reference. Unit tests compare normalized scenes,
reject malformed metadata and visible effects, and preserve original extension
XML through surrounding edits, picture transforms, export/reopen and full undo.
The schema checker validates the original published `CT_ShadowObscured` and
`shadowObscured` declarations independently, including unselected MCE branches.
