# Proofing exemptions

`control.docx` is independently authored by `tools/no_proof_fixture.py` with
Python's standard library and literal OOXML. It contains no font programs or
third-party artwork. Regenerate it before opening the reference application, not while it is open.

Nine English paragraphs cover ordinary spelling, direct/paragraph/character
exemptions, an explicit false override, mixed exempt/ordinary fragments, an
ordinary word split across runs, repeated inherited true, and a derived false.
`reference.json` binds the source hash to read-only reference spelling-error
ranges and effective NoProofing values. Open the exact fixture with the
reference-application helper before running `tools/record-no-proof.ps1`. Neither recorder nor helper
modifies source or global application settings.

The reference application reports five errors. The mixed paragraph reports only `vble`, at its actual
source range, while the ordinary split paragraph reports the full `Zzqxvble`.
Repeated true in the character-style chain remains true; it is not a toggle.
This agrees with ECMA-376 Part 1 §17.3.2.21 and §17.17.4; no spec/native divergence
is claimed. Grammar checking is not an implemented app feature.

Tests cover import, spelling boundaries/UTF-16 offsets, adjacent and exempt-run
typing, authoring through the model, exact no-edit/undo export, unrelated-part
retention, reopen, UI correction, and malformed-property rejection. Exported
proofing marks remain overlays; exemption declarations remain DOCX properties.
