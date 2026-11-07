# Full-color native texture fields

These eight native page captures come from the original independently authored
`../control.docx`, opened through the reference-application opening helper.
`capture.json` records source identity, preserved Saved state, eight physical
612 x 792pt pages and the hash/length of each compressed EMF.

`tools/capture_picture_3d_texture_colors.ps1` reads the exact confirmed owned
copy's page API without saving, view setters, font access or closing the reference application.
`tools/raster_picture_3d_texture_colors.ps1` verifies capture hashes and uses
Windows GDI+ to play the EMF+ dual stream into a 2448 x 3168 RGB page. The source
rectangle explicitly uses logical [0,0,5100,6600] units, rather than the rounded
millimetre frame. A second independent execution reproduces all eight PNG files
byte-for-byte. Compressed EMFs can be unpacked to a fresh scratch capture folder
with the same `capture.json` to replay this procedure.

`tools/record_picture_3d_texture_colors.py` binds the unchanged DOCX source,
all EMF hashes/lengths, declared record counts, bounded comment/EMF+ records,
600-DPI EMF+ headers and untransformed 5100 x 6600 GDI logical page mapping.
It rechecks PNG hashes and samples the same 49 fixed interior coordinates per
scene as the existing PDF diagnostic. `--record` writes the original reference;
the default mode revalidates it. Native output is never a viewer texture.

The older page GDI fallback uses four-bit palette images for two gray controls
and 16-bit RGB images for the other six controls. Its displayed RGB fields differ
from full-color EMF+ playback. Lossless encoding of those bytes does not make
those channels equivalent to full-color playback. The prior gradient PDF uses
JPEG and remains a separate diagnostic. Existing PDF expectations are unchanged.

All 392 full-color sample points agree with the viewer within two RGB levels,
inside the unchanged four-level dense-texture acceptance bound. Nine browser
cases include these eight fields and source-media preservation through editing,
exact undo and fresh reopening. The new source/native hash test and existing
geometry/lighting tests total 32 passing units; source and three exported packages
pass 40 schema views. Build, license checks and the native recorder pass.

The independent control contains only original MIT artwork. It includes no
corpus photographs, commercial font program or third-party document engine.
The original birthday card #10 still differs photographically and remains partial;
these fields do not certify complete shape boundaries or all original output.
Relevant OOXML clauses and limits are retained in the parent README.

Reference structure: [MS-EMFPLUS bitmap](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/112a5e2c-6bb3-4daf-8ee3-0f3d3984410f).
Compressed bitmap dimensions are read from their encoded image, not undefined
bitmap header dimensions. This tool uses installed native GDI+ playback rather
than implementing an alternate document engine.
