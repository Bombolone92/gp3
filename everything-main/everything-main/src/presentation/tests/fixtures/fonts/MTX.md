# Independent MTX decompression vectors

`mtx-vectors.json` contains synthetic byte streams encoded by the published
[MTX Appendix C reference codec](https://www.w3.org/submissions/MTX/). These are
compression tests, not font files. All input bytes and token sequences are
created by this project's generator.

Regenerate with Python's standard library and `clang`:

```sh
python3 tests/fixtures/fonts/generate-mtx-vectors.py
```

The generator downloads and verifies the normalized sample's SHA-256 before
compilation. It removes local includes because the submission concatenates the
headers and sources, corrects the original 32-bit pointer-size allocation,
declares an old implicit `int`, and replaces obsolete huge-pointer increment
casts with `memcpy`. These are portability changes; the compression, adaptive
trees, copy-distance and RLE algorithms are unchanged. The test-only driver
supplies ordinary memory allocation and files, and can emit explicit tokens
using the reference's own Huffman, length and distance writers.

Every valid vector is also decoded by the reference C decoder and compared with
independent plaintext before its digest is recorded. Invalid vectors are only
encoded; they are never passed to the original unbounded decoder. Normal tests
read the checked-in vectors without a network or compiler dependency.

Vectors exercise all eight dynamic alphabet ranges, every literal value,
single-byte preset references, tail-based copies, the 511/512/513 distance
boundary, multiple continuation digits, large and small copy windows, ring
wrap, weights above 32,767, noncanonical leading zero digits, shrinking and
expanding RLE, the 24-bit intermediate maximum, and malformed copies/RLE.

The reference source and format are covered by
[Monotype's W3C licensing statement](https://www.w3.org/standards/licensing/),
which grants royalty-free patent rights and sublicensable copyright rights
for the disclosed MTX software and format. The generator and driver are
project MIT code. No reference C source is bundled in the application.

The stream decoder feeds native TrueType reconstruction of CTF glyphs,
push/hint programs and metric tables. `scripts/generate-mtx-font-fixtures.py`
produces original MIT font fixtures and independently verifies the rebuilt
fonts with FontTools. It also extracts the published 128-row coordinate table
into `mtx-triplets.json`; test expectations use that table rather than the
runtime's arithmetic dispatch. The app uses reconstructed SFNT bytes locally
and keeps the original encoded PPTX payload intact through export/clipboard.
