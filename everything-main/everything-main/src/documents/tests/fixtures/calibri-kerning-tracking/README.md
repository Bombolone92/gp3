# Independent size, weight, kerning and tracking control

`tools/calibri_kerning_fixture.py --output-folder FRESH` manually authors sixteen
OOXML rows without the app serializer or corpus text. The control crosses
10/36pt Calibri, regular/bold, 0/14pt kerning threshold and 0/1pt character
spacing. It uses compatibility mode 15; unlike the capitals control, it does
not explicitly enable OpenType features. Relevant ECMA-376 Part 1 clauses are
§17.3.2.19 (kern), §17.3.2.35 (spacing), and §17.3.2.38 (sz).

`native-page-pdf-origins.json` records guarded fresh native page-metafile and
PDF observations separately. Both exports have pinned hashes; source bytes,
Saved state, view and zoom remained unchanged. The PDF reader strips font
program entries before constructing metadata fonts. No font program, native
PDF or raw metafile is distributed.

All sixteen actual Canvas paint calls reconstruct exactly as isolated
character paints. All 240 non-whitespace PDF character identities match.
Maximum horizontal differences are 0.725556pt against PDF metadata and
0.163582pt against the page-metafile origins. This is a bounded horizontal
origin comparison, not glyph-ink, whole-document or performance certification.

Subtracting each untracked row from its tracked partner exposes different
native paths. At the final character, adding authored 1pt tracking moves
the reference application's page origin by 15.96/16.08pt and the viewer by approximately 16pt.
The PDF change ranges from 15.336 to 15.97584pt, depending on size, weight and
kerning. Its declared font-size operators include 9.96, 12 and 36pt; that
inventory alone does not establish a general layout font-size rule.

The four capitals/literal-uppercase controls agree with the corresponding
36pt bold/14pt-kerning rows despite their different OpenType setting. Repeated
letter controls previously produced different average PDF tracking effects.
Neither a universal 0.96 spacing multiplier nor a font substitution follows
from these observations. Production text metrics remain unchanged and the
original cover letter remains partial. Next work must distinguish page layout
from PDF text emission with independently captured holdouts.

Local validation regenerates the package byte-for-byte and passes both
document/settings XML schema views. The fixture adds no runtime behavior.

Follow-up [48-case size emission holdouts](../font-size-emission/README.md)
separate raw native font-size declarations from character advances. Their
0.12pt size quantization is consistent across three fonts and two weights,
but quantizing browser measurements worsens many origins. This excludes a
global size correction without resolving the tracked/kerning rows here.
