# Original WOFF controls

`tools/woff_controls.py` is the complete original source for these geometric
fonts. It uses FontTools 4.66.1 (MIT) to author SFNT fonts and independently
encode/decode WOFF 1.0. No third-party font outlines or binaries are copied.
The legacy control has an AV kern pair, positioning uses the corresponding
GPOS pair, and optional adds compressed metadata and opaque private data.
All contain a literal separator glyph and normal/light metrics eligible for
synthetic-bold preparation. Dates are fixed for reproducible generation.

The `*-decoded.ttf` files are the independent FontTools reconstruction oracle.
Unit tests compare every byte, naming/face metadata and each private font
transformation; browser tests compare exact pixels and advances for original
WOFF and SFNT and the same transformations. These are packaging controls, not
native reference typography evidence or a claim of support for arbitrary font data.
