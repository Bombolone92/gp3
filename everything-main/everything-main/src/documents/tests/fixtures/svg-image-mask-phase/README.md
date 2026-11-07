# Native image-mask source phases

See [the companion kernel controls](../svg-image-mask-kernel/README.md) for
generation, capture, provenance, results and limitations. These six cases use
single white source-pixel columns at x=64 through x=69 on an RGB-128 background.
At the tested 8:1 reduction, the reference application produces identical rasters for phases 0–3
and another identical pair for phases 4–5. This exposes the intermediate block
average that was invisible in the earlier straight-edge control.
