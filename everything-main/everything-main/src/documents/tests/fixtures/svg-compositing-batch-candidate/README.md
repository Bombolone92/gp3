# Rejected disjoint-stage compositing experiment

This is archived original project code under the repository license, not a
production feature. No corpus content or third-party assets are included.

Reconstruct the earlier bounded-cache candidate following
`../svg-compositing-cache-candidate/README.md`, then apply `batch-candidate.patch`
inside that disposable directory. The patch only changes its compositor.
Reconstruction was verified against the tested module with normalized LF text;
the evidence records both raw tested module hashes and a normalized compositor
hash. Keep the actual app on unchanged main, hosted at `0.0.0.0:5173`.

Run the existing isolated probe:

```
node tools/probe-svg-compositing-cache.mjs DISPOSABLE_DIR/src/engine OUTPUT.json
```

Device-space padded bounds build an ordering dependency graph. Only disjoint
layers with the same blend-operation class share a stage; every intersecting
successor remains in a later stage. Stage schedules retain exact transform and
fractional-placement keys, are bounded to 128 variants per plan, and release
their bitmaps on close. The 4 MP raster budget stays unchanged.

The candidate matches all 36 external-backdrop interior colors. Its union
rasters exceed the budget at the internal fixture's 1200 by 900 reference size,
so that path falls back and retains eight known mismatches. In the smaller page
paint probe it uses its stages, but mean latency is 54.58 ms/page versus the
current renderer's 3.05 ms/page. Close releases all retained pixels and entries.
The resource and performance gates reject this candidate. No native edge,
corpus, editing or export equivalence is claimed, and it must not be shipped.
