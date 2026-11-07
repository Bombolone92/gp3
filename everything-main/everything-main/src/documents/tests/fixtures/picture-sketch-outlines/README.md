# Sketch regeneration: unresolved native control

Generate `public/fixtures/picture-sketch-outlines.docx` with
`python -X utf8 tools/picture_outline_fixture.py --sketch`. This uses the same
original project XML and quadrant artwork as the ordinary outline controls;
case 10 additionally has `ask:lineSketchStyleProps`, a saved rectangle, curved
sketch type, and seed 12345. No corpus content is included.

The reference application exported `native.pdf` read-only. `reference.json` retains the
source/PDF hashes and the initial native diagnostic samples. Removing only the
sketch extension yields the ordinary fixture and its separate native reference PDF.

With the extension, the reference application replaces the supplied separate rectangular stroke and
texture paths with irregular cubic paths. Without it, the reference application uses those supplied
paths. Thus rendering cached `a:custGeom` alone is not equivalent to the reference application for
this control. The seed is intended to reproduce geometry for a given shape,
transform and sketch type, as described by
[MS-ODRAWXML ST_LineSketchSeed](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/a5fdcd3a-d82c-4a37-9917-92988c13350c).

Regeneration is not implemented. Strict import keeps this extension guarded.
Read-only preview paints the supplied standard custom paths instead of dropping
the whole picture group. The separately stored stroke contour is used as-is;
ordinary picture-outline offsets must not be applied again to this cached path.
This can differ from the reference application's regenerated geometry, as this control demonstrates.

Unit tests require read-only status, retention of all twelve pictures, unchanged
package parts, blocked exports and conservative handling of unknown or malformed
metadata. The browser test checks four points derived from the authored paths,
blocks typing, downloads the exact original bytes and reopens read-only. These
are cached-path checks, not claims of matching the regenerated native reference PDF. Do not
count this native control or corpus template 95 as completed by the preview fix.

Validation for the cached preview: 21 targeted unit checks, nine browser checks,
17 source/export package schema checks, and the production build/license gate
pass. The original template 95 also restores its portrait/ink group on one
read-only page and preserves the original package on download. Its completed
status does not change.
