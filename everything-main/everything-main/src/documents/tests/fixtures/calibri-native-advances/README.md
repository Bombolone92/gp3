# Calibri word grouping and advance controls

`tools/calibri_native_advances_fixture.py --output-folder FRESH` manually authors
20 rows with explicit regular 10pt Calibri, zero character spacing and disabled
kerning. Each of `a/e/i/n` appears sixteen times, grouped into words of 16/4/2/1
letters. Four additional cases cover punctuation, a pipe separator, nonbreaking
spaces and neutral mixed words. The text is independent of corpus documents.
Relevant ECMA-376 Part 1 clauses are §17.3.2.38 `sz`, §17.3.2.19 `kern` and
§17.3.2.35 `spacing`. These observations do not establish a spec divergence.

Adding `--open-type-features` creates a paired package with only the
`enableOpenTypeFeatures=1` compatibility declaration added in `word/settings.xml`.
All other package parts and the common `cases.json` remain byte-identical.
Both variants regenerate to their recorded source SHA-256:

- Default: `12967258e62951e06a3e3992dce73bb5bf75ea42b3745aa2b4fbbd2eb3c9f7aa`.
- Explicit OpenType: `e51f0903f0b37ce7d28056ce96950229e08429b953cd19cb15b7314919dc0052`.

The reference opener confirmed each exact source in the reference application before read-only
capture. Source bytes, Saved state, view and zoom stayed unchanged. Native PDF
and page metafiles remain private and hash-bound. PDF font programs are stripped
before metadata font construction; page records provide descriptors and advances
without inspecting glyph programs or contours. These simple horizontal page
records have a 5100×6600 window for a 612×792pt page. Whitespace-only paragraph
mark paints in the application default font are excluded. Adjacent Calibri records
in the nonbreaking-space row are joined only after exact native origin continuity
checks; their spaces remain part of the advance comparison.

Both variants have 336 matching non-whitespace identities. All forty actual
Canvas paint calls reconstruct exactly from isolated character paints, with
zero whole-page RGBA changes caused by tracing. Native page and PDF origins are
identical between the paired variants, as are current viewer origins. This is
a bounded no-kerning Latin result, not a claim about all OpenType behavior.

Native advances vary inside unbroken runs. Sixteen `e` characters use a mixture
of 41 and 42 native units; sixteen `n` characters mix 43 and 44. Thus word-boundary
adjustment alone cannot explain the integer advances. Independently rounding
each measured Canvas advance to 0.12pt is also insufficient: it worsens 127
origins and raises the maximum native-page difference from 0.172269pt to 0.72pt.
It matches several rows exactly, but those matches do not justify a general
renderer change. The probe is a numerical diagnostic only.

The viewer remains unchanged. Native character adjustment, cumulative rounding
and shaping need further isolation. These controls do not prove glyph ink,
whole-document visual fidelity, font-version equivalence or corpus completion.
The original cover letter stays partial.

Follow-up cumulative rounding also fails the no-regression gate. Nearest
rounding lowers maximum retained origin error to 0.120pt but worsens 128 of
336 origins. Floor and ceiling worsen 195 and 121 respectively. Both source
variants produce identical numerical results. Reproduce with
`python tools/probe_cumulative_text_rounding.py FRESH_REPORT.json`.
This tool reads retained coordinates only; it does not establish fresh font
identity or change screen/print metrics.

A Windows API follow-up retains the same captured LOGFONT and compares installed GDI extents plus three
declared ScriptJustify hypotheses. All retain larger maximum errors than the
current viewer control. A shared face name does not establish matching font
version or reference printer context; no spacing correction follows.

Validation: byte-exact regeneration of both variants, four document/settings
schema views, nine metadata-reader tests and forty guarded paint reconstructions.
[Paired native observations and rejected numerical probe](native-page-pdf-origins.json).
