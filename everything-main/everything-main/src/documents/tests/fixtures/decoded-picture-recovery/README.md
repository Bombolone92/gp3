# Decoded picture recovery

Generate with `python tools/decoded_picture_recovery_fixture.py`. The generator
uses Python's standard library and the original image-recovery OPC skeleton.
All XML, pixels and symbols are original; no source template artwork is included.

The two packages differ only in `word/media/image2.png`: the broken version has
valid declared dimensions and an invalid compressed pixel stream. Both XML
packages validate against the transitional and published drawing-extension XSDs.

The page contains an anchored, cropped, flipped and rotated picture; a nested
group with a failed picture and healthy picture/text siblings; stretched and
tiled picture fills with retained text and an outline; and a cropped/flipped
inline picture in a text box. The outline must remain after the marker is
painted. A numbered paragraph, named style and header remain supported.

Expected recovery: a neutral marker occupies the affected frame or filled shape,
without applying source-pixel cropping to the marker. Source geometry, supported
siblings and text remain intact. The document becomes read-only, reports the
failed asset, refuses edited export and downloads the exact original file. A
broken page background retains the solid page color instead of tiling a marker
(covered by the separate image-recovery controls).

This is application recovery behavior, not a claim that damaged images conform
to OOXML or a reference/spec divergence. Relevant retained geometry and content are
ECMA-376 Part 1 §§20.1.8 (DrawingML fills), 20.2 (pictures), 20.4 (Wordprocessing
DrawingML), 17.3.3 (run content), and the published WordprocessingShape/
WordprocessingGroup extension specifications. Unsupported outer structures and aggregate
resource limits can still prevent local recovery.
