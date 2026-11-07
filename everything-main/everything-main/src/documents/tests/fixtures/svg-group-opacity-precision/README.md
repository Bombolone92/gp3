# Native SVG group-opacity precision

Original rectangles authored by `tools/svg_group_opacity_precision_fixture.py`.
No corpus artwork or font programs are included. The existing fixture generator
uses python-docx (MIT), lxml (BSD), and the Python standard library.

Twenty-three groups isolate decimal opacity boundaries, each with an opaque
12 × 12 rectangle and a separate one-pixel strip with fill-opacity `.503`.
This distinguishes group-alpha conversion from paint-alpha conversion and
checks the subsequent application of group alpha to partially transparent paint.
The three basic half ties `.1`, `.3`, and `.7` produce native alpha 25, 76,
and 178, while `.5` produces 128. Blanket tie-down rounding is therefore wrong.
Nearest Float32 conversion and a truncated 16.16 opacity factor also fail.

`capture.emf` was read from the first inline picture's Range.EnhMetaFileBits in
the reference application, with the document read-only and unchanged. `native.emf`
and the 23 PNGs were extracted by `tools/record_svg_group_cubic.py` using its
`--fixture svg-group-opacity-precision` option. The manifest binds all source,
case, capture, metadata, nested-metafile, and PNG bytes by SHA-256.

The browser test checks reference integrity, layer bounds, source-tree
preservation, and temporary-host cleanup before asserting exact native agreement.
The initial diagnostic exposed eleven differing groups. The generic correction
now matches all 23 groups exactly; the expected-failure marker was removed.
No tolerance or former mismatch count is an acceptance target. Editing, export,
reopen and byte-exact undo are also checked.

Chromium's computed style additionally rounds `.49999999` to `.5`; the reference application retains
a meaningful distinction at that boundary. Reading only Number(getComputedStyle
opacity) cannot explain every authored case. Preserving raw precision must also
respect the SVG/CSS cascade; using a document-specific attribute override would
not be a valid correction. `svg-group-opacity-precision-holdouts` straddles 22
Float32 boundaries and confirms conversion to the lower adjacent Float32 before
rounding to a byte. The cascade family adds 28 independent stylesheet, inline,
inheritance, invalid-declaration, percentage, exponent and SVG reuse controls.
All 73 native layers are exact RGBA references. The native distinction between
stylesheet and inline `inherit` is explicitly recorded as a spec divergence.
