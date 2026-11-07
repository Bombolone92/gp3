# JPEG color-change compatibility controls

Schema correction: generators supply required w:zoom/@w:percent and place
paragraph shading before spacing. Fresh sources/exports pass schema checks.
Regenerated native PDFs are pixel-identical; all 8,364 samples are unchanged.
Source/PDF hashes were refreshed after regeneration.

`tools/jpeg_color_change_fixture.py` independently creates these files with
python-docx, Pillow and lxml. Artwork consists of original rectangles, a circle
and a triangle. No corpus content is redistributed.

`control.docx` compares original JPEG, PNG containing the same decoded pixels,
and each format with white made transparent. `native.pdf` is the one-page native
reference. Both native/browser full-page captures were inspected;
the JPEG fringe correction is visible while PNG retains its narrower color key.

`thresholds.docx` has twelve pages, one case per page, with 697 constant-color
swatches each. The grid includes all grayscale bytes, separate white-channel
offsets, positive/negative colored-key offsets and diagonal boundaries. JPEG
and decoded PNG use the same input colors. Cases cover default/false useA,
opaque replacement and source alpha at 255, 254, 253, 239, 238 and 128.
`thresholds.json` records authored and JPEG-decoded center colors.

`thresholds-native.pdf` is the native export. Run
`tools/record_jpeg_color_change.py` to record its image-center RGBA samples in
`reference.json`; source/PDF hashes bind those observations. PDF images
remain at source resolution. The recorder handles raw Flate RGB and JPEG DCT
streams separately and asserts the decoded byte count.

The reference application matches JPEG color keys within 16 bytes per RGBA channel. PNG's existing
one-byte tolerance with useA and exact opaque matching without useA remain
unchanged. When useA is false, effect alpha values are ignored and source/target
alpha become opaque before matching. JPEG alpha 239 matches an opaque source;
238 does not. Matching is per-channel, including diagonal offsets.

Part 1 sections 20.1.8.16, .17 and .19 describe clrChange/source/target colors;
the local specification was inspected. Its color replacement description does
not specify these format-dependent tolerances. This fixture establishes native
compatibility beyond literal exact-color matching. Production uses the decoded
format, including JPEG bytes in a mislabeled part, without changing source XML.

Unit and browser tests check all 8,364 swatches. Transformed samples permit one
RGB byte for PDF premultiplication/rounding. The reference application recompresses the two unchanged
JPEG cases, introducing at most two bytes of RGB difference; those cases use
that measured bound, require native/engine opacity, and the unit test requires
exactly unchanged source pixels. This is not a claim of identical JPEG codecs.
Original and independent-control no-edit preservation, editing, exact undo,
unrelated-part preservation and exported reopening were separately verified.
