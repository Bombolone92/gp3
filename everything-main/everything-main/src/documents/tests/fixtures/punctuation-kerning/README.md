# Punctuation kerning native controls

Original manually assembled OPC/XML fixtures; no template source or third-party document engine is used. Fonts are referenced by name, not redistributed.

Generate the Latin controls with `python tools/canvas_punctuation_kerning_fixture.py`, then the East Asian controls with `python tools/canvas_punctuation_kerning_asian_fixture.py`. Export each of the six fixtures to the matching `*-native.pdf` using the reference application. Record and check PDF character coordinates with `python tools/record_punctuation_kerning_reference.py`.

The reference application renders all 52 Latin and 72 mixed Japanese/Korean cases with exactly equal extracted character boxes for `noPunctuationKerning=1`, `=0`, and omission. Each variant has three pages. Latin controls use Times New Roman and Arial; East Asian controls use MS Gothic, Yu Gothic, and Malgun Gothic with explicit language/font slots and enabled/disabled run kerning.

The Latin disabled-run controls distinguish an ineffective flag from ineffective kerning: enabling run kerning moves the terminal marker left by 12pt for AVATAR, 3.552pt for T.A and T,A, and 1.8pt for T’A, including when the punctuation suppression flag is true.

This diverges from ECMA-376 Part 1 §17.15.1.60, which describes suppression of punctuation kerning. The renderer follows the measured native behavior and preserves the declaration in the untouched settings part. The published MS-OI29500 §2.1.410(b) note also documents kerning all characters when kerning is enabled. Its Korean editing-language default note does not establish a geometric difference in these controls.

These controls do not certify all East Asian typography or every native Canvas/font pair. Existing native shaping differences (such as Rockwell space pairs) remain separate open issues. The application has no new UI toggle for this retained setting.

References: ECMA-376 Part 1 fifth edition, printed page 1048 (PDF page 1058); [Open XML SDK noPunctuationKerning reference](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.nopunctuationkerning); [MS-OI29500 implementation notes](https://officeprotocoldoc.z19.web.core.windows.net/files/MS-OI29500/%5BMS-OI29500%5D-170919.pdf), §2.1.410, page 151.
