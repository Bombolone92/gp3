# Independent text-advance control

`control.docx` is original XML authored by `tools/text_advance_control_fixture.py`.
It contains six landscape paragraphs with identical original prose: Franklin
Gothic Book at 10pt (one run and word-separated runs), 11pt and 12pt, Arial at
10pt, and Noto Sans at 10pt. Kerning is explicitly disabled. It embeds no font
programs or other third-party assets. The generator reproduces identical bytes.

The exact scratch copy opened successfully through the reference-application opening helper.
The reference application displayed all six lines on one page. Fixed-format export and
repeated collapsed `Range.Information(5/6)` observations left the source bytes
and saved state unchanged. Native source SHA-256:
`e683d1771178cb93bab007b65d22164dc8096a6709721279e2c8bd2e9f70a395`.
Native PDF SHA-256:
`fa72c7da16a6d8a8959768f02a25b7c6982530c83bcb23a57cae7007fc4cfafb`.

`reference.json` retains explicit PDF Unicode and character origins only.
The PDF remains private and is not shipped. Its font programs were excluded
before constructing metadata-reader font objects. `native-screen-reference.json`
retains numeric caret observations on this original control, whose screen
coordinates have 0.75pt resolution. Neither reference contains a font program.

All 612 non-whitespace characters matched exactly, with no unmatched characters
or inferred Unicode. The 10pt Franklin Gothic single-run and split-run controls
have identical horizontal positions in both consumers. Maximum browser versus
PDF caret-origin differences are 0.568pt for Franklin Gothic 10pt, 0.184pt at
11pt, 0.212pt at 12pt, 0.528pt for Arial 10pt, and 0.822pt for Noto Sans 10pt.
The reference application screen versus browser caret differences for Franklin Gothic and Arial are
at most 0.388pt. Screen quantization prevents finer conclusions. The native reference and
the browser's bundled Noto versions have not been established as identical.

The reference application's PDF declares 9.96pt for authored 10pt text, 11.04pt for 11pt, and 12pt for
12pt, and includes additional text-position adjustments. Rounding the editor's
measurement font sizes to that 0.12pt grid **worsens** the control's maximum
residual to 2.113pt. That candidate is rejected and no renderer change is made.
The observations do not establish a painted-glyph defect or a reference/spec
divergence. OOXML `sz` (§17.3.2.38) remains the authored half-point size; PDF
export declarations are not a replacement for the source document's semantics.

Reproduce the authoring and schema checks locally:

```sh
python tools/text_advance_control_fixture.py
python tools/check-docx-schema.py tests/fixtures/text-advance-control/control.docx
node tools/capture-body-char-origins.mjs tests/fixtures/text-advance-control/control.docx PRIVATE_APP.json
```

After independently opening and verifying the exact owned reference copy and
exporting it without source mutation, record its reference and compare:

```sh
python tools/record_text_advance_native.py PRIVATE_NATIVE.pdf PRIVATE_OWNED_STATE.json PRIVATE_REFERENCE.json
python tools/compare_pdf_char_origins.py PRIVATE_NATIVE.pdf PRIVATE_APP.json PRIVATE_COMPARISON.json --reader metadata
```

The owned state must supply the matching `sourceSha256`, reference-application build, export
method, and true `sourceUnchanged`, `savedBefore`, `savedAfter`, and `visible`
flags. Printed glyph spacing and
whole-page fidelity still require separate verification.
