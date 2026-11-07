# Original-font NBSP policy control

These three original CFF fonts contain rectangle outlines and deliberately chosen
metrics. No installed or third-party font outlines were copied. Their complete
source is `tools/legacy_nbsp_policy_fonts.mjs`, using the repository's existing
MIT-licensed OpenType serializer. `tools/legacy_nbsp_policy_fixture.py` authors
OPC/XML directly, with a separate deterministic embedding key for each face.
FontTools is not required to reproduce these committed controls.

| Face | A advance | Space advance | NBSP advance | NBSP outline |
| --- | ---: | ---: | ---: | --- |
| NBSP Distinct Equal | 600 | 250 | 250 | Empty |
| NBSP Distinct Wide | 800 | 250 | 600 | Empty |
| NBSP Distinct Ink | 1000 | 250 | 600 | Rectangle |

All faces use 1000 units/em, W advance 700, space–W pair -100, and NBSP–W
pair -200. Their A rectangle widths also differ. They have legacy `kern` and
no GPOS. Twelve 36pt paragraphs compare `A WA` with `A\u00a0WA`, with kerning
disabled/enabled for each face. The distinct A markers verify source-face
selection independently of the NBSP behavior under test.

## Native evidence and its limits

The reference application displays the authored rectangle glyphs. `native-30.png`
shows all twelve rows, including the three distinct A widths. The Ink NBSP
row still has only the three A/W/A rectangles; its NBSP rectangle is absent.

`reference.json` records explicit positions from the reference application's `native.pdf`. The
ordinary-space and NBSP rows have equal start/end positions in each pair.
On NBSP rows, the reference application positions A, the separator and WA separately, allowing the
recorder to verify each face's marker advance (21.6, 28.8 and 36pt) as well as
separator advance (9pt disabled; 5.4pt enabled). The Wide/Ink literal-NBSP
predictions would instead be 21.6pt and 14.4pt. All twelve origins and total
widths agree with the ordinary-space predictions within 0.2pt.

**The PDF text layer names Calibri/Aptos.** Its font widths/outlines are not the
source-face reference. The recorder uses explicit text matrices and the final
paragraph-mark origin only, rejecting transformed text and in-span adjustments.
Distinct marker advances plus the native screenshot establish the source-face
geometry/appearance separately. No PDF-to-browser pixel comparison is claimed.
The reference application's range-position API gave inconsistent coordinates and is not used.

The JSON binds the DOCX, three fonts, PDF and screenshot hashes. Earlier controls
with identical A markers could not conclusively distinguish the faces; those
controls and experimental TrueType exports are excluded from this evidence.
No font-substitution cause or embedding-key compatibility rule is inferred.

This establishes display behavior for these original **legacy-kern CFF** controls
alongside the installed Rockwell controls. It does not establish behavior for
active GPOS/GSUB, variable fonts, every script or every reference compatibility mode.
The renderer now follows these measured space/NBSP origins and glyphs. No
reference/spec divergence is claimed. The browser controls below cover a bounded
editing/export sequence, not general editing equivalence.
Relevant OOXML: Part 1 §§17.3.2.19 (`kern`), 17.3.3.31 (`t`) and §17.8 fonts.

## Browser regression controls

`tests/browser/legacy-nbsp-policy.spec.js` verifies the three distinct embedded
faces by their A advances, all twelve logical strings and native baselines, and
editable import. Ordinary passing assertions check native origins/ends, caret
positions and identical ordinary-space/NBSP glyph pixels with kerning disabled
and enabled. A narrow-layout control repeats each nonbreaking phrase three times
and checks that wrapping occurs only at the added ordinary spaces.

The UI test selects and copies the actual NBSP, inserts a supported glyph beside
it, downloads, undoes, and reopens the edited DOCX. No-edit/undo downloads must
preserve every uncompressed part; edited downloads preserve every part except
`word/document.xml`, including embedded font bytes and relationships. The geometry
tests use isolated HTML with application CSS to avoid concurrent preparation by
the playground's default document. The UI test uses the real playground.

Display and caret measurement use ordinary-space glyphs without replacing the
logical NBSP. Legacy pair conversion restores space-leading kerning in supported
static fonts. Early preparation keeps derived faces unregistered until native
face selection and synthetic-bold checks finish. Earlier qualification and
rejected load-cost experiments concerned unshipped candidates.

## Reproduction

1. `node tools/legacy_nbsp_policy_fonts.mjs <output-directory>`.
2. `python tools/legacy_nbsp_policy_fixture.py <output-directory>`.
3. Open `control.docx` in the reference application using the reference-opening helper. Verify
   the three distinct rectangle widths before collecting native evidence; a
   requested font name alone does not prove that the reference application used that face.
4. Export `native.pdf` from the exact open source and capture the native whole-page
   display as `native-30.png`. These are display controls, not reference-saved
   replacements for the independently authored source.
5. `python tools/record_legacy_nbsp_policy.py <output-directory>` (requires pypdf).

The font generator fixes head timestamps to reproduce the committed fonts.
DOCX ZIP timestamps may differ; compare the uncompressed package parts.
