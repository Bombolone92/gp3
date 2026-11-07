# Encoded Symbol bullets

The original `tools/symbol_bullet_fixture.py` authors OPC/XML directly. The reference application exported the two-page PDF. `record_symbol_bullet.py` records its text
baselines, marker ink bounds/areas and source hashes independently of the engine.
The 24 cases compare Symbol U+F0B7, Symbol U+2022 and Arial U+2022 at 10/20pt,
each with normal, bold, italic and combined formatting.

U+F0B7 is the encoded Symbol bullet. Converting it unconditionally to U+2022
caused Chromium to use the bundled font's smaller bullet even with Symbol
installed. Import now retains both the original glyph and readable fallback;
canvas measurement and painting select the encoded glyph only when using its
own font. Unicode labels and unavailable-font fallback retain their previous
behavior. Numbering regeneration writes the encoded source value, unless the
label was replaced. No fonts are added or fetched by this feature.

Browser tests compare the eight encoded-glyph cases against the reference application, relative to
their baselines, with 1pt edge tolerance and an ink-area ratio of 0.65–1.35.
This catches the incorrect small fallback glyph without claiming identical
native font synthesis. Unit checks cover available/missing font measurement and
paint agreement, source preservation, numbering regeneration and replacement.

Remaining discrepancies are retained in the control rather than hidden:

- The reference application places these exact-40pt body lines differently from the current engine;
  absolute baselines are recorded for a separate exact-line-spacing correction.
- The reference application and Chromium synthesize bold/italic Symbol outlines differently.
- The reference application displays missing-glyph boxes for the Unicode U+2022 labels explicitly
  assigned Symbol; the app still displays its readable fallback. These eight
  diagnostic cases are not certified by the encoded-glyph regression.

The relevant corpus source uses U+F0B7 in automatically spaced paragraphs. Its
two bullet regions change, with text positions and all other pixels unchanged.

### Host-font and fallback verification

The browser compares native reference Symbol outlines only when the local Symbol reference
face exists. On every host it also checks the actual glyph sent to fillText and
an independently rasterized native glyph at the layout baseline (edge/area
absolute differences below 0.5pt/0.5pt²). The native reference uses U+F0B7 when
Symbol is available, otherwise U+2022 in the bundled Noto font. It does not call
the application's glyph-conversion or paint helpers.

A second browser variant simulates absent local Symbol face/family availability
while leaving the DOCX and application logic unchanged. Both variants retain the
edit/export/reopen and exact-undo checks. Existing native reference tolerances are unchanged;
the smaller fallback bullet is valid when the requested font is unavailable.
The separate native reference exact-spacing and Unicode-label discrepancies remain open.
