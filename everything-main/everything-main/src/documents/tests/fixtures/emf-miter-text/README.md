# Original text-bearing EMF miter controls

These original rectangle/chevron paths and logical Arial text records were
authored by `tools/emf_miter_text_fixture.py`. No corpus artwork or font binary
is included. The generator uses the repository's original minimal DOCX shell.
Reproduce each source with `python tools/emf_miter_text_fixture.py --variant
context|integers|empty|effects --output EXISTING_FOLDER`; select one variant.
ZIP timestamps can differ; every uncompressed package member reproduced exactly.

Each row pairs untreated paths with a picture effect. The context variant tests
no text record, visible text, font creation/selection alone, and FLOAT 8 with text.
The [integer variant](../emf-miter-text-integers/) tests UINT32 1, 2, 8 and 10.
The [empty-buffer variant](../emf-miter-text-empty-buffers/) distinguishes no
record from zero-character/empty-buffer, whitespace and visible text records.
The [effect variant](../emf-miter-text-effects/) tests grayscale, duotone,
color-change and 50% alpha. Default context effects use luminance -100000.

`native.emf` is an unmodified reference Content.EnhMetaFileBits
capture of the exact original opened using the approved reference-opening helper. Its
sidecar binds source/capture hashes and confirms the source stayed unchanged.
`native.pdf` is the native reference export. `native-0.png` through `native-3.png`
are the unchanged compressed bitmap bytes extracted from the capture by
`tools/record_emf_miter_text.py`, using the bounded published EMF+ evidence reader.
These are derived QA artifacts of our original controls, under the repository
license; they are not font software or a proprietary renderer implementation.
`native-reference.json` records PNG/RGBA/PDF hashes and measured geometry.

Native effects with a validated EMR_EXTTEXTOUTW record use small UINT32 miter
values, even when that record occurs after the paths or emits no characters.
Font selection alone does not switch this behavior. Vector-only effects retain
FLOAT interpretation. Runtime retains the per-path saved state and switches
bounded integer values up to 100000 only for text-bearing effect playback.
Opacity uses a separate transient asset identity; alpha is still painted once.
Original media and relationship bytes survive edits, reopen and exact undo.

References: [MS-EMF 2.3.11.21 EMR_SETMITERLIMIT](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/2637d0d0-92dd-48e8-be5e-6400b4d1fc5e)
specifies UINT32, while [Appendix A note 90](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/f5148c7c-30c5-4d95-bf1b-b449c1f8f53d)
records FLOAT Windows behavior. ECMA-376 Part 1 20.1.8.42 defines luminance.
These controls establish the supported reference compatibility subset where the
two interpretations differ; they do not establish universal decoder behavior.

Fifteen native bitmap geometry comparisons pass. The context FLOAT-8-with-text
diagnostic is excluded: The reference application drops its outlines, while the viewer keeps
healthy existing FLOAT rendering. There is no full pixel/typography equivalence claim.
At native 800-pixel widths, retained acute tips still differ by about three
pixels owing to GDI quantization. Native vector-only FLOAT 2 uses a clipped
miter, which remains a separate gap. Neutral opacity/luminance edge contexts
need more native evidence. Empty-buffer native glyph output is not certified.
