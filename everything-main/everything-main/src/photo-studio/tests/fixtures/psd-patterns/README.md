These are original test resources encoded with **psd-tools 1.23.0 (MIT)**.
They contain generated samples and Unicode names, with no proprietary patterns,
images, or profiles. `generate.py` is the reproducible source.

The RGB resources vary 8/16/32-bit channels across RAW, RLE, ZIP and ZIP prediction.
RGB and sheet alpha remain separate VMAs; 32-bit RGB includes HDR, negative zero
and subnormal values. Other resources cover grayscale, indexed palettes, partial
channel rectangles, and a written-but-empty VMA. Bounds differ from the stored
vertical/horizontal size point to catch confusion between size and tile origin.

These resources verify parsing and native samples. They do not claim to verify
pattern-fill sampling, geometry, color conversion or editing behavior in other
applications.

The browser pattern-resource tests also resolve these tiles through the immutable
asset store after PSD import, native project persistence and PSD export/reopen.
Set `PSD_PATTERN_EXPORT_DIRECTORY` when running those tests, then run
`python tests/fixtures/psd-patterns/validate.py <directory>` with psd-tools 1.23.0
to independently verify all 12 exports and their complete records/native planes.
The validator requires the complete export set so an empty directory cannot pass.
