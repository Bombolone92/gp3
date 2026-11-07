# Tiled shape picture fills

These are original OPC/XML controls with an authored four-color raster. No user
brochure, proprietary artwork, or document engine generates them.

`tools/picture_tiles_fixture.py --reference` reproduces the 19 core cases whose
native reference export is `native.pdf`. The normal generator adds four density
controls in `shape-picture-tiles-extended.docx`. Unit tests verify that its first
19 parsed scenes exactly equal the reference fixture's scenes.

`tools/record_picture_tiles.py` records the core source/PDF hashes, PDF tiling
pattern matrices and 2,046 interior raster samples at 288 DPI. The reference
uses native reference output, not the canvas renderer. Cases cover default repetition,
asymmetric scale, signed offsets, center/bottom-right alignment, every flip mode,
source crop insets/outsets, explicit fill DPI, embedded PNG density, local-DPI
flags, combined properties, negative scale and polygon clipping.

Observed compatibility behavior:

- Tile flip declarations are retained but ignored by the reference application for these shape fills;
  all three flip controls have the same PDF pattern as the default control.
  This differs from ECMA-376 Part 1 §20.1.8.58's adjacent-tile reflections.
- Tile dimensions follow embedded pixel density (96 DPI without physical
  metadata). Explicit blipFill DPI does not replace that physical size here,
  unlike the size calculation described in §20.1.8.14. It can change the PDF's
  internal texture sampling resolution. Local-DPI flags do not alter these
  controls' physical periods. Source declarations are never rewritten.
- Source insets crop the bitmap inside the original tile size. Source outsets
  move and shrink its visible image; the reference application repeats that visible region rather
  than inserting transparent gaps. Alignment precedes the crop displacement.
- Nonpositive scale paints no fill. Native repeating patterns avoid an
  unbounded CPU loop for tiny positive tile periods.

The 23-page extended fixture also contains JPEG JFIF, JPEG EXIF, conflicting JPEG
metadata and anisotropic PNG density controls. Their bounded metadata parsing is
unit-tested. **Their four extra native page comparisons remain pending**: the reference application
stopped confirming new file opens while extending the controls, and desktop
input returned Access denied. No reference is claimed for those four pages.
The 19 core native pages were captured successfully before that opening problem.

Supported new subset: PNG/JPEG tiles in retained Wordprocessing-shape fills,
including existing custom paths, transparency/effects and ordinary group
transforms. Source cropping, scale, alignment and numeric offsets are retained.
Tiled vector fills and nonrotating tiled fills on rotated shapes remain guarded;
ordinary pic:pic tiled fills remain outside this shape-fill change.

The browser checks all core native samples, then edits, exports/reopens and restores
the exact package with undo. The construction brochure separately verifies the
real grouped JPEG tile with 96-DPI EXIF metadata and its two-page editing workflow.

Metadata references (no third-party implementation copied):

- [PNG physical pixel dimensions](https://www.w3.org/TR/png-3/#11pHYs)
- [CIPA Exif/TIFF resolution fields](https://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf)
