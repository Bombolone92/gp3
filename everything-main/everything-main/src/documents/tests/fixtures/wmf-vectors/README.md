# Original placeable WMF polygon controls

`tools/wmf_vectors_fixture.py` packs original records using Python `struct` and
embeds them in our own DOCX test layout. No third-party metafile implementation
or source-template artwork is used. The eight panels compare implicit and
explicit anisotropic mapping, translated origins with negative vertical extents,
ordinary and padded null pens, and alternate versus winding polygon filling.

The reference application opened the exact committed control path and exported
`native.pdf`. All eight panels were visually inspected. `record_wmf_vectors.py`
records 15,514 stable native pixels, excluding antialiased edges with a uniform
nine-pixel neighborhood rule. The browser matches every retained sample through
insertion and export/reopen; undo and untouched media preservation are checked.
This is not a pixel-identity claim for antialiased edges.

## Standards and native reference behavior

MS-WMF sections 2.3.3.15 (Polygon), 2.3.4 (object records), 2.3.5 (state),
3.1.3 (mapping), and 3.1.4.1 (object table) define the record/state behavior.
The embedding player supplies the viewport. The native controls demonstrate
that the reference application supplies anisotropic playback even when SetMapMode is omitted.
This is embedding-context behavior, not a claim that the standard's default
GDI mapping mode is anisotropic.

MS-WMF 2.3.4.5 specifies a ten-byte Pen payload. The reference application accepts an additional
trailing WORD and ignores its arbitrary nonzero value (1234 in this control).
The reader permits both the standard sixteen-byte record and the reference application's eighteen-
byte form, retaining the original bytes. This compatibility allowance is
independent of the corpus file's particular trailing value.

## Current supported subset and remaining work

The reader supports placeable headers, anisotropic window origins/extents,
solid/null brushes, polygon fill modes, null-pen polygons, saved state and
object selection/reuse. Solid pens may be created and selected, but a drawing
operation using a visible pen still rejects: cosmetic/logical stroke widths
need native-device controls. Non-placeable WMF, bitmap/text/region/escape records,
other mapping modes and other drawing operations remain unsupported and retain
the read-only fallback. Unsupported operations are never silently skipped.

Output contains only generated numeric SVG geometry and colors, loaded in an
isolated image context. The reader bounds bytes, dimensions, records, saved
contexts, points and output size. It does not execute escapes or load resources.
Original media and content types remain untouched on DOCX editing/export.

This resolved the WMF decoder failure in corpus #240. Its rotated floating
placement was a separate subsequent fix; see `floating-picture-rotation` for
that native evidence. These WMF controls alone do not certify the original
document's placement or overall rendering.
