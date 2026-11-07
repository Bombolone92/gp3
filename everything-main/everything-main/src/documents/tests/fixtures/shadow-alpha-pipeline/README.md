# Translucent-source and blurred-shadow controls

Generate with `python tools/shadow_raster_sampling_fixture.py --alpha-pipeline`.
Twenty-four original OPC/XML controls combine authored black PNG source alpha
64/128/192, blur 0/3/18/48 pt, and white/purple shadows at 60% opacity.
No corpus artwork, external fonts or third-party renderer is included.
The authored sources and derived captures use the repository license.

The reference application opened the exact source read-only. Capture using
`tools/capture-shadow-color-metafiles.ps1 -FixtureDirectory tests/fixtures/shadow-alpha-pipeline -FirstPage 1 -LastPage 24`;
record with `python tools/record_shadow_alpha_pipeline.py`.
The recorder validates source-image alpha and retains full shadow pixel
histograms from native EMF+ PNG objects, plus hashes for all source/capture
files. These are native exported image bytes, not direct screen pixels.

The opacity-byte/premultiplied-channel/16-bit reciprocal model established by
the shadow-color-quantization controls matches all pixels of six unblurred
cases and twelve white cases, including blur. It fails every colored blur
case. Each of those nine cases contains BOTH `(102,51,204,5)` and
`(153,51,204,5)` in the same shadow bitmap. Identical final alpha and declared
color therefore do not determine final RGB. This directly rejects adding
color quantization solely after alpha-only blur. It supports investigating
processing of premultiplied color channels during blur; it does not yet
establish a kernel, intermediate precision, or rounding sequence.

No production change or tolerance relaxation follows from these controls.
Corpus document #128 remains partial; the wider native blur/sampling gap remains.

### Channel-stage feasibility follow-up

A mask-then-tint follow-up
admits a shared byte mask at every corresponding white/purple pixel and in an
independent textured control. It quantizes the brush before masking. Two rendered
prototypes still regress previously exact samples and are rejected; compatible
native pixels do not certify a kernel or justify changing production painting.

An axis-symmetry diagnostic
also distinguishes native alpha processing from RGB conversion. All twelve
white/purple pairs have identical alpha maps; 3pt/18pt square shadows are
reflection-symmetric but not transpose-symmetric. This does not prove a kernel
or pass order. Native references and production painting remain unchanged.

`tools/check_shadow_channel_stages.py` rules out both a common linear blur with only endpoint byte rounding and a simple horizontal/vertical byte-intermediate model. Even the latter contradicts 2,808 pixels in two colored controls. This does not identify the reference application's kernel or establish that compatible pixels have been reproduced. Production painting and expected failures remain unchanged.

A later grid/filter investigation
reproduces fourteen full RGBA controls with one global mask-before-brush model.
The source-alpha-128 and 48pt cases still fail. The current reference application reproduces all
24 older shadow PNG hashes, but Saved/XML capture failures are explicitly
retained. Neither selected exact controls nor a lower textured error sum
justifies a renderer change that worsens previously exact samples.

A coefficient follow-up
matches all eighteen 0pt/3pt/18pt buffers exactly with one 15-bit hypothesis.
All six 48pt buffers, four independent geometry holdouts and five textured
sample regressions remain counterexamples. Native references are unchanged.

A mask-sampling follow-up
matches all 24 native RGBA buffers with one original padding-parity/8-by-4
diagnostic. The new exact assertion has no exclusions. Independent geometry and
textured-picture counterexamples remain; production painting and these native
references are unchanged.
