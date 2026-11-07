The browser regression generates independent PSD/PSB inputs with deliberately stale magenta raster caches, three original RGB color stops and three opacity stops, precise double placement/smoothness, a negative layer origin and a parameter-only pixel mask. It varies all five Classic fill styles, aligned versus document-space placement, 8/16/32-bit depth and both GPU backends. Production import reconstructs the native material, native bundles retain its frame and definition, and production PSD exports remain editable after a layer translation.

After running `tests/browser/vector-gradients.spec.ts`, run:

```sh
python validate.py /tmp/photo-editor-native-gradient-exports
```

The validator uses the MIT-licensed `psd-tools==1.23.0` package. It independently checks all 60 production exports for descriptor classes, units, precise double values, fixed-range stop locations and midpoints, color roles, masks, translated rectangles, opacity and absent raster color payloads. The outputs remain temporary artifacts; no third-party sample assets are redistributed.

Separate browser checks cover HDR and opacity/stroke overlap, paint edits that reuse geometry, picking, crop/nonuniform canvas resize, native persistence of an independent paint affine, controls, undo and locks. Native saving and integer translations with exactly representable paths retain raw pixels exactly. Cropped/resized paths at other dimensions require PSD's signed 8.24 rounding; those checks bound alpha and premultiplied contributions by the coordinate half-quanta and float arithmetic precision. They do not claim byte-exact raw RGB at newly introduced sub-quantum edge coverage.

These are application regression and descriptor interoperability checks. They do not establish sampling, paint-frame anchoring, high-depth interpolation or arbitrary transform fidelity in other applications. Dithered gradients, non-Classic methods, noise gradients, dynamic color roles and gradient strokes/effects remain unsupported.
