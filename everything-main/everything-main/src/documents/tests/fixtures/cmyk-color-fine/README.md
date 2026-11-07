# Fine original CMYK references

Generated with `tools/cmyk_color_grid_fixture.py --step 16 --holdout 2048
--batch 128 --output tests/fixtures/cmyk-color-fine`. The 83,521 grid colors
and 2,048 seeded holdout colors occupy 669 independently authored pictures.
No ICC profile, proprietary table, or corpus image is included. The generator
verifies every JPEG sample against its authored CMYK value before packaging.
Its default arguments still reproduce the earlier 48-picture fixture exactly.

The reference application opened this source read-only and repaginated it.
Each inline picture's Range.EnhMetaFileBits is retained as its one-based index
in native-metafiles.zip. Recapture with tools/capture-picture-metafile.ps1
using InlineIndex 1 through 669. All captured DIBs are indexed, preserving
eight-bit RGB palette values. Source DOCX passes ten schema checks.

Run `tools/analyze_cmyk_color_grid.py --root tests/fixtures/cmyk-color-fine`
to reconstruct the observations and write a diagnostic candidate-analysis.json.
The committed reference hashes the source, cases, captures, and all reconstructed
RGB samples. The JavaScript test independently reconstructs the palette samples
and evaluates four-dimensional multilinear interpolation.

The candidate is rejected: maximum held-out channel error 6, mean per-sample
maximum error 0.47314453125. Four held-out colors reach the maximum, primarily
near red-channel clipping. A prior step-32 diagnostic with 512 holdout colors
had maximum error 8 and mean 0.806640625. These sets have different sizes, so
their maxima are not a controlled convergence comparison. No runtime conversion
is shipped, and corpus document #155 remains partial. Increasing grid density
alone has not established native color fidelity. These are reference metafile
observations, not a claim of live-screen or PDF pixel identity.

On the same first 128 holdout colors, the step-64/32/16 grids have maximum
errors 20/3/2 and mean errors 1.5078125/0.8203125/0.453125 respectively.
The larger holdout exposed failures that the smaller comparison would miss.

OOXML Part 1 §§15.2.14 and 20.1.8.13 do not prescribe the device-CMYK color
transform; this records compatibility evidence, not an OOXML contradiction.
