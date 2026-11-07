# Cubic integer-translation controls

These are 129 independently authored curves from the existing broad API sweep
and narrow arch controls, each captured at seven integer offsets: (0,0),
(128,0), (0,128), (512,512), (-512,-512), (4096,4096), and (65536,65536).
Inputs are converted to Float32 and rounded upward to the 1/16 grid before
translation. No corpus coordinates, paths, artwork or font programs are included.

`native-api.json.gz` retains the exact read-only Windows
`System.Drawing.Drawing2D.GraphicsPath.Flatten(null, 0.25)` capture bytes;
`cases.json.gz` retains the exact hashed input bytes. Deterministic gzip removes
repeated whitespace without discarding evidence. `reference.json` binds both
files and their original source controls. The zero-offset results agree with
the separately retained earlier API captures. A second 903-curve capture agrees
byte-for-byte after the same LF input generation.

All 774 translated captures equal their unshifted native vertices after removing
the offset. The renderer also preserves translation for these 903 grid-aligned
inputs. This is an invariance test, **not an exact native matching claim**: the
baseline renderer matches 707/903 API contours, leaving 28 distinct broad curves
(196 translated instances) different. Reference-application DOCX raster references are separate;
this family adds no new native raster proof or normative reference/spec divergence.

The operation-order probe tests dividing each second-difference term by 2, 4,
or 8 before adding, versus dividing the sum by 8. Broad exact-contour counts
are 85, 85, 84, and 83 of 113; all retain 16/16 narrow controls. Neither
translation nor the tested reordered divisions establishes a correction.

Reproduce using the repository's existing Python dependencies and Windows API:

```powershell
python tools/svg_cubic_translation_probe.py <scratch>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/capture-cubic-flatten-sweep.ps1 -InputPath <scratch>/cases.json -OutputPath <scratch>/native-api.json -QuantizeInput
python tools/svg_cubic_translation_probe.py <scratch> --native <scratch>/native-api.json
npx vitest run tests/svg-cubic-translation.test.js
```

No renderer behavior, tolerance, dependencies or corpus-document status changed.
