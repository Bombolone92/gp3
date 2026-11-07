# Large encoded PNG/JPEG parts

Original raster/OPC controls from tools/large_raster_parts_fixture.py. Dependencies:
Python stdlib, Pillow (HPND), lxml (BSD), and the repository's original picture
control. No corpus media is included. Three 64 x 32 images show two colored bands:
a small JPEG, the same JPEG with valid COM segments taking it above 10 MiB, and a
PNG with a valid ancillary tEXt chunk above 10 MiB. ZIP compression keeps the
fixture small while media parts retain their full sizes.

The reference application exported native.pdf. The independent recorder samples
both band interiors at 288 DPI and stores the source/PDF hashes and media sizes.
The native/browser control pair was visually inspected. Small JPEG color
rounding differences in the reference application's exported PDF allow a three-byte browser tolerance.
Label font metrics are not the subject of this image-decoding control.

Unit coverage verifies dimensions, the unchanged session-byte/pixel limits,
large-media editing, generated export, reopening and byte-exact undo. Browser
coverage verifies decoded colors before/after editing and reopening and checks
original media preservation. Both large formats fit the existing 50 MiB encoded
and 64-megapixel aggregate session budgets. TIFF/SVG-specific bounds and the
image-file chooser's existing 10 MiB policy are unchanged.
