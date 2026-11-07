# Native EMF miter/effect controls

`tools/emf_miter_effects_fixture.py --variant a` and `--variant b` author original
rectangle and acute-chevron paths directly as EMF records. Only the page/anchor
scaffolding comes from the original `shape-defaults` control. No corpus artwork,
document engine, native image decoder or copied implementation authors the paths.
Each row pairs an untreated black outline with an identical white outline with
DrawingML brightness -100000. Each image is 128 × 126 CSS pixels.

Eight cases cover UINT32 8, FLOAT 8, FLOAT .5, FLOAT 2 followed by UINT32 8,
FLOAT 0, FLOAT 2 followed by FLOAT .5, FLOAT 1 and FLOAT 10. The raw record bytes
and prior state are recorded in each folder's `cases.json`.

Native reference captures were taken from the exact helper-opened, saved original
sources using `tools/capture-emf-range.ps1`. Source bytes were checked unchanged;
`native.emf.json` records source/capture hashes and the reference application build. Native PDFs were
exported from those same original documents. `tools/record_emf_miter_effects.py`
validates the captures with the bounded native-range reader, extracts original
compressed PNGs without resampling, verifies their hashes and records PDF hashes.
Native range bitmap dimensions are 800 × 787/788; PNG dimensions, rather than
undefined compressed bitmap header dimensions, are authoritative.

The FLOAT 8 and FLOAT 10 effect pictures retain their acute miter tips. Every
other effect picture bevels the acute join, including both cases with prior
FLOAT 2 state. For the central third of each image, below the top rectangle
border, the first opaque tip row is 47 for the two valid high limits and 123
for the other six. The threshold is alpha >175. Browser tests independently
read native pixels and compare tip geometry within one device pixel.

This rejects both a global UINT32 interpretation and ignoring the subunit FLOAT
record to retain the default limit 10 in the picture-effect pipeline. It does
not establish the complete behavior of negative, nonfinite or enormous limits,
nor exact GDI antialiasing equivalence. The renderer retains its existing FLOAT
interpretation and clamp to 1; no runtime code changed for this investigation.

Relevant primary references: MS-EMF §2.3.11.21 and Appendix A note 90; the Win32
[SetMiterLimit documentation](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setmiterlimit)
describes rejection of subunit values, while these reference effect controls
demonstrate bevel output. DrawingML luminance is ECMA-376 Part 1 §20.1.8.42.

Checks: 31 unit tests including eight new cases, two native browser comparisons
covering all eight effect images, six schema views across the two controls.
No corpus document is promoted and no pixel-equivalence claim is made.
