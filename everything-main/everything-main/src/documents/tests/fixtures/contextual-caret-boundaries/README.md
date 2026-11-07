# Complete-run optional-ligature caret controls

`tools/contextual_caret_fixture.py` manually authors four original OOXML
paragraphs: Source Sans Pro and its Light face, kerning off/on, and explicit
`standardContextual` ligatures. It reuses only an authored minimal package shell.
All text and XML are MIT repository material. No corpus text or font program is
included. The reference application opened an unchanged owned scratch copy; the
reference-opening helper confirmed the exact path before observation.

`native-carets.json` records all 120 detached collapsed `Range.Information(5/6)`
positions, source/page hashes, saved state and observed zoom. `native-page.emf`
comes from the same native page. The recorder changes neither selection nor
zoom and closes only the explicitly supplied owned copy. Reproduce by opening
a hash-identical scratch copy, then running:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/record_kerned_caret_boundaries.ps1 -Source ABSOLUTE_SCRATCH_COPY -OutputRoot ABSOLUTE_SCRATCH_OUTPUT -ExpectedSha256 cfe3029702ed1f14f2475ec461e65ad51bd93481bef0d13643fb55b96b14bcfb -CloseOwnedDocument
```

These are reference screen-coordinate observations with observed 0.75pt granularity,
not exact native glyph origins. The browser uses the existing bidi suite's
0.5pt screen-coordinate bound for this separate control, checks every insertion
point and pointer hit, and preserves exact no-edit/undo parts and edited
unrelated parts through reopening. The earlier pair-only fixture's 0.4pt bound
and all existing PDF glyph tolerances remain unchanged. The Light/off row has a
remaining maximum 0.433027pt native caret difference; this is not complete native
raster or font-version equivalence.
