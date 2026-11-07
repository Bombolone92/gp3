# Bundled Noto horizontal script origins

The independently authored control contains 36 cases: regular, bold and italic
Noto Sans, six sizes (8, 10, 11, 12, 16, 20 pt), superscript and subscript.
`tools/bundled_script_fixture.py` adapts the original script-size OPC control;
it includes no embedded fonts or third-party template content.

The reference application successfully captured the three faces using
`tools/capture_bundled_script_metafiles.ps1` and Range.EnhMetaFileBits.
The script temporarily registers the existing, unchanged bundled Noto assets,
opens the source read-only, closes its own reference application instance and removes the
registrations. An earlier PDF export stalled and was stopped; that attempt
is not a native reference. The successful EMFs supersede that pending attempt.

Run `tools/record_bundled_script_origins.py` to verify the bounded GDI/EMF+
records and write `origin-reference.json`. It checks source, cases, metafile
and font hashes, Unicode text/advance order, font descriptions, unit transforms,
and the horizontal frame at 0.12 pt per logical unit. It deliberately does not
map the vertical frame. Reselecting all 33 captured font descriptions reproduces
every font table from the bundled assets; this verifies current font resolution,
not a retrospective dump of the reference application's font bytes during capture.

All 36 native script origins equal the preceding run's advance. Each super/sub
pair also has identical prefix advances and script origins. The browser test
checks actual canvas paint origins without a local-font permission grant:
zero additional gap within 0.001 pt, absolute origins within 0.2 pt (observed
maximum below 0.105 pt). The earlier horizontal-offset fix left regular and bold
pages unchanged and moved only italic script origins. The size fix below changes
script dimensions on all three pages.

The recorder also retains each script's negative LOGFONT height at the established
600-unit scale. The 36 sizes agree with half-point rounding of the font's vertical
script-size recommendation. The browser now checks both actual paint dimensions
against those native sizes within 0.061 pt. This replaces the old unequal 65% X /
60% Y fallback for eligible variable fonts.

The font metadata reader checks the MVAR record directory for `sbys`, `spys`
and `spyo`, the fields needed by the existing reduced-size rule. These fields
are constant in both bundled Noto faces. The [OpenType MVAR specification](https://learn.microsoft.com/en-us/typography/opentype/spec/mvar#processing)
defines absent tags as constant across variation space. Fonts with varying or
uncertain required metrics retain the fallback pending instance interpolation.
No family-name exception or font modification is used. Vertical placement remains
unresolved; these size checks do not establish full superscript/subscript equivalence.
ECMA-376 Part 1 §17.3.2.42 specifies vertical alignment and smaller display,
not these exact horizontal metrics. No normative DOCX divergence is claimed.

## Vertical-origin verification (2026-10-01)

`tools/record_bundled_script_positions.py` now validates the vertical frame of
the same three independently captured EMFs and writes `position-reference.json`.
It checks source/case/font/capture hashes and reselects every font description.
These 36 observations are included in the production script-position matrix
and actual-paint browser checks. They resolve the vertical-placement gap above
for these controls, including the 10 pt subscript's 0.96 pt displacement.
Position uses the recommended offset rounded in point space before applying
device-metric bounds. No bundled-font family exception is used. This does not
claim all variable-font instances or complete document layout equivalence.
