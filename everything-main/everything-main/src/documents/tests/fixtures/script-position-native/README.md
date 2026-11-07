# Native script-position matrix

`tools/record_script_position_cases.py` combines 558 ordinary script observations
from independently authored controls and bounded native reference captures. It
records 128 font metric sets and hashes every source and native reference.
Nine installed Windows faces are represented only by numeric metric facts and
font hashes; their proprietary font binaries are not distributed. Original
OFL derivative controls and the existing bundled fonts retain their licenses
and reproducible source generators in their respective fixture directories.

Matrix bindings normalize CRLF to LF for JSON references only, so Git checkout
line-ending conversion does not invalidate the observations. Binary DOCX,
font, PDF and EMF bindings remain exact. The native references' own original
capture hashes are checked before this matrix normalization.

The matrix covers fractional sizes, recommended-size and offset boundaries,
Windows ascent/descent, external leading, sparse VDMX device bounds and the
bundled regular/bold/italic Noto faces. Production tests compute both the
reduced size and vertical position, rather than supplying the reference application's reduced size
as an input. On the reference Windows host they additionally check the actual
font bytes and parsed metadata; elsewhere installed fonts use the bound
numeric reference facts.

The 600-DPI captures resolve positions in 0.12-point units. Assertions allow
0.061 pt for half-device rounding. ECMA-376 Part 1 §17.3.2.42 specifies vertical
alignment and smaller display without prescribing these numerical metrics.
The formula implements observed native compatibility. Unknown or varying
required metrics preserve the existing fallback.
