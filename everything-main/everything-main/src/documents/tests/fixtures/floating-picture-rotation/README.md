# Original floating-picture rotation controls

`tools/floating_picture_rotation_fixture.py` assembles the DOCX XML directly,
using our original four-color PNG. Eighteen pictures cover zero/ordinary/quarter
turns, angles around 45 degrees, negative and multi-turn values, both flips,
positive/negative crops, half opacity and asymmetric effect extents. Positions
are independent numeric page offsets. The reference application opened the exact committed
source path and exported the three-page `native.pdf`; all three picture-page pairs
were inspected against the browser.

The unrotated frame center stays fixed. Crop and flips precede clockwise
rotation. Zero or asymmetric `wp:effectExtent` does not clip floating ink:
the independent controls deliberately omit rotated-corner reservation.
The later inline-picture-extents controls remove the former inline reservation
guard and establish a separate orientation-frame/line-clipping convention.
Floating ink retains the behavior verified here; no reference/spec divergence is claimed.

`tools/record_floating_picture_rotation.py` uses the installed Poppler CLI to
render the native PDF at four pixels per point and records 19,913 samples plus
all picture bounds. The uniform sample rule requires a constant 17-by-17-pixel
neighborhood. Bounds include antialiased edges using a chroma threshold.
PDFium was independently found to darken otherwise constant affine-transformed
image colors by two levels; PDF image bytes and Poppler agree with the original
PNG. The reference therefore uses Poppler, with no engine color compensation.
No renderer source or dependency is incorporated into the application.

Native comparisons exercise the image pixels through body editing and reopening.
Opaque interior samples match exactly; the half-opacity control permits one
channel level of PDF compositing quantization. All visible bounds match within
one point. Antialiased edges are not certified pixel-identical.
Unit checks cover rotation/size edits, anchor and media preservation, exact undo,
inverse-rotation hit testing, cell clipping and full rotated selection bounds.
A browser click selects a quarter-turned picture outside its unrotated rectangle.
The fixture's default-font heading is only a test label; its typography is not
part of the native image comparison.

Scope: ordinary standalone pictures with `wrapNone`, existing supported anchor
coordinates, matching inner/outer extents and rotating fills. Text-wrapped
rotation, nonrotating fills, rotated custom-geometry/outlined/shadow pictures
and mismatched inner/outer dimensions retain their prior unsupported guards.
These controls do not independently certify rotated collision displacement or
relative-size/aligned-anchor combinations. Original signed rotation spelling,
image bytes and unrelated OPC parts remain preserved.
