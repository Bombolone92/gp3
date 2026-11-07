# Controlled font script metrics

These eighteen test-only fonts are renamed derivatives of the repository's
OFL-1.1 Bebas Neue Regular. Copyright © 2010 Dharma Type. The unmodified license
is included as `OFL.txt`; upstream font and corresponding `.glyphs` source
revision, URLs and hashes are recorded in `public/fonts/PROVENANCE.md`.
The base TTF SHA-256 is
`08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73`.

The complete derivation is original code in `tools/script_metric_controls.py`.
It changes family/full/PostScript/unique names, the selected OS/2 script metric,
checksums and removal of the now-invalid DSIG. Glyph outlines, advances,
character maps and shaping tables are unchanged. The reference extractor
verifies those facts, whole-font checksums and the actual PDF font identity.
No proprietary font binary or third-party rendering implementation is added.

`controls.docx` has one page per metric variant, with baseline, superscript and
subscript text at a declared 20pt. `export_script_metric_controls.ps1`
temporarily registers these uniquely named fonts, opens the exact source
read-only in the reference application, exports the PDF, then closes its own
reference-application instance and removes the font registrations. No fonts are installed persistently.
Run `script_metric_reference.py` afterward to verify/extract the reference.

The reference application uses the vertical script size uniformly in both axes
in these controls: changing horizontal script size alone does not change the
result. Changing vertical size does. Horizontal offset alone has no effect
on these regular-face controls. Offsets are not always copied directly from
OS/2: some values trigger fallback or clamping, and a small superscript offset
also changes subscript behavior. `reference.json` preserves these results
without treating a guessed formula as an established rule.

Relevant definitions: ECMA-376 Part 1 §17.3.2.42 (`vertAlign`) and the
[OpenType OS/2 script metric fields](https://learn.microsoft.com/en-us/typography/opentype/spec/os2).
OpenType describes recommended metrics; OOXML does not mandate the reference application's numerical
fallback algorithm. These are investigation controls for unresolved generic
glyph sizing/offset behavior, not passing application rendering tests.
