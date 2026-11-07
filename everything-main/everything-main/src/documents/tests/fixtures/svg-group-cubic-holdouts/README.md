# svg-group-cubic-holdouts

Original, independently authored SVG cubic-path controls. Geometry and color declarations were written for this repository; no corpus artwork or font programs are included. The DOCX places the same SVG in full, cropped, grouped and shape-fill contexts using the existing permissively licensed fixture shell.

Generate with `python tools/svg_group_cubic_fixture.py --holdouts`. Fresh generation reproduced every uncompressed ZIP member and `cases.json`; ZIP timestamps are not a reproducibility promise.

The native reference came from the reference application opening an owned copy read-only, then reading inline picture 1's `Range.EnhMetaFileBits`. `capture.json` binds the unchanged source and capture; `metafile-reference.json` binds the nested native metafile, PNG layers and their world transforms. The capture closes the exact owned document and quits only an independently identified new reference-application process. This is an observed native picture reference, not a generic metafile renderer or full-page equivalence proof.

Re-extract using `python tools/record_svg_group_cubic.py CAPTURE_ROOT --fixture svg-group-cubic-holdouts`. The recorder validates a bounded record inventory, excludes font objects and extracts six embedded PNG layers. Native programs and fonts are not redistributed.

Four layers match native RGBA exactly. The negative-coordinate/nested-alpha case retains 14 differing alpha pixels and 39 differing RGB pixels; the near-1/16 boundary case retains seven differing alpha/RGB pixels. Tests retain those explicit limits rather than claiming exact equivalence.

Source SHA-256: `b318937635b20691407cfa5723d6d12c4328375725c901c5e40fe5ff604211e5`.
