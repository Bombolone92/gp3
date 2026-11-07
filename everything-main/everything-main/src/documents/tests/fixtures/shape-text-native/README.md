These PDFs were exported by the reference application from the independent
fixtures named in references.json. Their document.xml hashes match the shipped
fixtures. The captured source hashes identify the exact original inputs.

The ellipse generator's initially omitted w:zoom/@w:percent was subsequently
set to 100 for schema validity; this changes settings.xml, not document geometry.
The original native reference captures remain identified separately rather than relabeled
as captures of the amended packages.

Regenerate the source fixtures with tools/canvas_ellipse_fixture.py followed by
tools/canvas_shape_spacing_fixture.py. The latter also uses the existing
independently authored group-text-scaling.docx fixture.

The overflow tests compare text-frame clipping dimensions against the actual
PDF clipping operators. The browser tests separately check painted pixels.
The spacing probes produced identical text, point sizes and PDF text positions
for compatLnSpc=0 and 1. These observations concern Wordprocessing shapes with
w:txbxContent; they do not establish behavior for DrawingML a:p text.
