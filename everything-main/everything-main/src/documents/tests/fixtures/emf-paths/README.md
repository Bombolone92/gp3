# Original EMF path controls

`tools/emf_paths_fixture.py` authors the binary EMF records directly with Python
struct packing, and embeds them in our independently authored DOCX layout.
No document or metafile rendering engine creates the inputs. All artwork is
original: cubic paths in 16/32-bit forms, copy clipping, even-odd/nonzero holes,
solid geometric pens, anisotropic mapping, saved/world-transformed state, and
current-position continuity between non-advancing and advancing curves.

The reference application exported all three PDFs after the exact document path was
confirmed. The integer and float-miter sources were opened at their committed
paths. The inset-bounds source was opened as `emf-inset-bounds.docx` in scratch;
every package part of the committed source was checked against that input.
`tools/record_emf_paths.py` records hashes and stable 4x native reference raster samples:
15,327 for the base, 15,326 for `--float-miter`, and 15,327 for `--inset-bounds`.
The selected pixels match exactly through body edit, export, reopen and undo.
Antialiased edges are excluded using a uniform nine-pixel neighborhood rule;
no per-picture sample exclusion or color tolerance is used.

## Reference/spec compatibility

MS-EMF §2.3.11.21 declares MiterLimit as UINT32, while Appendix A note 90 states
that Windows GDI consumes FLOAT. The base source encodes integer 10; the reference application reads
those bits as a tiny positive float and bevels the joins. The float variant
encodes IEEE float 10 and retains the miter tips. Our playback follows the reference application's
float interpretation; values below one have the equivalent SVG bevel cutoff.

The inset variant changes only the first image's ink bounds. The reference application emits identical
picture geometry: the physical frame and reference-device metrics control the
viewport, including the final device pixel. Ink bounds must not crop or enlarge
the picture. The final curve panel also proves that a non-advancing Bezier leaves
the logical current point unchanged; the following To curve reconnects to that
point in the existing figure.

## Supported subset

The original reader supports path brackets, MoveTo/LineTo, polygon/polyline and
cubic point arrays, solid/null brushes and pens, copy/intersection path clips,
clip reset, MM_TEXT/MM_ANISOTROPIC mappings, affine world transforms and DC
save/restore. It emits only generated numeric vector markup in isolated image
context. No external resources, script, fonts or embedded alternate-format
payloads are loaded. Original EMF package bytes are retained.

Bitmap records, text/font records, arcs, gradients, pattern/dashed pens, EMF+,
other mapping/region modes and other unimplemented record types reject before
editable import. Such source content remains preserved in the read-only fallback.
This is not a claim of complete EMF or WMF support.
