# Full-alpha luminance conversion observations

`tools/picture_luminance_alpha_fixture.py` authors a 256-by-16 PNG with constant
RGB(200,40,80) and all byte alpha values, using the original neutral-luminance
OPC control. Its nine cases retain absent, neutral, repeated neutral, tiny
positive/negative and 25% brightness effects. There is no corpus content.

The reference application exported the exact source read-only to `native.pdf`.
The native page was visually inspected. The PDF retains the original 256-by-16
image dimensions, so the recorder samples image bytes without resampling.
It records all 2,304 image-RGB/soft-mask-alpha tuples and the black Matte value;
these tuples are not straight RGBA or rendered page colors. Source, case and
PDF bytes are hash-bound in `reference.json`.

Every neutral sample matches the absent-effect sample at all alpha levels.
For the smallest positive brightness, alpha 127/128/129 produces stored RGB
(99,19,39)/(99,19,39)/(100,19,39). At 25% brightness, the saturated red component
is 126 at alpha 127 but 128 at alpha 128. Alpha itself is unchanged in every case.
These values reject a simple fixed channel subtraction or a correction calibrated
only to the earlier alpha-64/128 patches. Straight/PARGB conversion precision
must be separated from PDF compositing before changing runtime behavior.

The observations supplement ECMA-376 Part 1 §20.1.8.42's unspecified channel
quantization. They do not establish a universal color formula: this sweep uses
one RGB triplet. Tested arithmetic hypotheses and a local GDI+ ColorMatrix probe
still differ from the reference application. None was installed in the renderer. The provenance tests
verify the reference only; the semitransparent rendering gap remains unresolved.
