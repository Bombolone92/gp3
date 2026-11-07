These tiny PSD/PSB files are original generated test data, created by
`generate.py` using the independent MIT-licensed psd-tools 1.23.0 encoder.
They contain no third-party image assets. The generator and files are covered
by this repository's license.

The unprefixed files have a nested group with two raster layers: a long parameter-only
pixel-mask header, and a mask with a second (-3) channel. Both carry density,
feather, inversion, relative-position and reserved flag fields. Primary bounds
are (-3,7,0,9), real bounds are (9,-4,11,-1); both planes have six samples.
The generator specifies samples directly, including float32 negative zero and
the smallest positive subnormal. Compression is RLE for 8-bit PSD, ZIP for
16-bit PSB, and ZIP with prediction for 32-bit PSD.

Their stored composites are deliberately blank. These validate binary
interoperability and exact samples, not rendering or mask editing behavior
in other applications.

The `primary-*` files isolate supported editable masks on a raster layer in a
nested group, with different layer and mask bounds. They retain native samples,
all four neutral feather/vector parameters, density 102/255, inversion, unlink
and reserved flags. Their blank composites require production import to use
editable layers. Browser tests check both renderers, native persistence, PSD
export and reopening; they do not establish rendering behavior in
other applications.
