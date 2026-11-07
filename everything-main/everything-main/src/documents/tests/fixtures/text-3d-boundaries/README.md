# Original text-bevel boundary controls

Five original glyphs distinguish filled nested contours, a true hole, a shared
edge, crossing contours, and a retraced edge. They use regular 325pt text with
matte bevels. No synthetic bold is used, so these isolate boundary construction.

The reference application exported the retained PDF. Current main paints spurious interior
bevels in four cases: 1,880 / 0 / 1,280 / 1,861 / 15 failing stable samples. The
corrected private boundary candidate passes all five (maximum channel errors
2 / 2 / 2 / 2 / 3). The earlier candidate returned early when no edge required
splitting and therefore missed nested filled contours and full shared edges.
A genuine hole must retain its inner bevel. Candidate results do not describe
shipped behavior; production rendering is unchanged.

The comparison uses a uniform four-pixel grid at four pixels per point, native
3x3 neighborhoods with at most one channel value of variation, and channel
error tolerance four. No alignment, region exclusions, or relaxed tolerance.
`reference.json` records counts, hashes and sixteen representative failing
samples per failing case; regenerate to run the full grid.

Reproduce while a review server is available:

```
python tools/text_3d_boundary_fixture.py --output SCRATCH --url CANDIDATE_URL --baseline-url BASELINE_URL
python tools/compare_text_3d_shallow_joins.py SCRATCH
python tools/compare_text_3d_shallow_joins.py SCRATCH/baseline
```

The generator creates an original outline font using the existing OFL Source
Sans Pro header scaffold, normalizes its metrics, registers it only for its
owned reference/browser captures, and unregisters/deletes it in `finally`. No font
binary or proprietary glyph outline is redistributed. Opening this DOCX after
the temporary font is removed uses fallback and is not a valid comparison.

This is a native rendering requirement, not a claim that OOXML specifies a
polygon-union algorithm. MS-DOCX CT_Props3D declares the effect; its internal
boundary construction is not specified there. The source's document, styles,
and settings pass the standard-MCE ECMA-376 transitional schema checks.
