# Caption and spacer flow control

Original OOXML from `tools/caption_row_flow_fixture.py`, with installed Arial
Black 12pt captions, Arial 10pt empty prefixes and Arial Bold 18pt labels.
Six cases vary a narrow spacer's vertical merge, bottom nil declaration and
table style. No artwork or font program is embedded.

Saved, unchanged reference captures reproduce the original classroom pack's
lower-panel discrepancy: cases 1–2 place the label 382 logical units after the
last caption baseline; cases 3–6 use 378. Each logical unit is approximately
0.12pt. The original viewer gave about 45.398pt for all cases, missing the native
difference caused by suppressing a styled spacer's bottom edge. A vertical merge
is not required. Row allocation now separates the row's own bottom extent from
the shared winning paint boundary; the nil cases advance by the border width.

All six browser position comparisons now agree within 0.12pt. Unit controls also
vary the inherited border width rather than fitting a fixed offset. Native
mapping, border geometry, descriptor fonts, source hashes and deterministic
regeneration have separate tests. Range-local baseline differences do not
require physical page anchoring. Exact helper-opened saved-source moniker
binding does not prove identity with the reference application instance. Original corpus
captures remain private and the corpus document remains partial.
