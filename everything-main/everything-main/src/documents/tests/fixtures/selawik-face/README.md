# Selawik Semibold exact-face control

`tools/selawik_face_fixture.py` authors an original one-page document with eight
samples: 16pt and 24pt, each regular, bold, italic, and bold italic. Blue 4pt
markers expose line advance independently of text extraction. No corpus content
or embedded font binaries are used. The reference application opened the source
read-only and exported `native.pdf`; the native page was visually inspected.

The reference application embeds Selawik Semibold version `1.01;O365`. The unmodified upstream 1.01
release is loaded only when the exact native face is missing. Its weight is 600.
Registering it as weight 400 incorrectly triggered synthetic bold, increasing
coverage by about 26% and advancing the marker by 0.25/0.375pt. Registering the
actual 600 weight preserves the reference application's unchanged Semibold ink under an added bold
declaration. Italic and bold italic use the same synthesized slant as the reference application.
This is face selection, not a document-specific metric adjustment.

`tools/selawik_face_reference.py` records the eight native marker positions and
source/PDF SHA-256 hashes. `tools/record_source_sans_family_ink.py` is the shared
eight-style ink recorder; run it with this control, PDF, `ink-reference.json`,
and `--reference-version 16.0.20326`. At 384 DPI the eight coverage ratios are between
0.99629 and 1.00136. All marker origins are within 0.005pt of the reference application. Browser tests
retain 0.15pt advance and 5% coverage limits, rather than fitting tolerances to
this result. Coverage uses whole-line regions aligned by measured baseline;
it is not a pixel-identity test.

Browser verification covers lazy same-origin loading, preserved source parts,
editing, exact undo, and reopening. Unit tests cover a native face taking
precedence, concurrent/case-insensitive requests, unavailable exact faces despite
selectable siblings, and failed asset loading. Font provenance, editable source,
original OFL notice, and binary hash are in `public/fonts/PROVENANCE.md` and the
license gate. No system font was installed or proprietary font copied.
