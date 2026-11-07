# Independent EMF text controls

`tools/emf_text_fixture.py` writes original MS-EMF bytes inside the repository's
authored EMF-paths DOCX envelope. It does not copy corpus drawings or use another
metafile renderer. Eight cases exercise a logical Arial font, explicit Unicode
characters and advances, baseline/top/center/right alignment, bold/italic,
two-axis advances and anisotropic transforms. No font binary is redistributed.

The reference application opened the control read-only, verified its full path,
and exported the one-page `native.pdf`. All eight text cases are visible in that
reference. `tools/record_emf_text.py` records native glyph bounds and hashes.
The DOCX source passes transitional and supported-extension schema checks.
Those schemas do not validate the EMF payload itself; native playback provides
the independent rendering reference.

Primary format references:
- [EMR_EXTCREATEFONTINDIRECTW, §2.3.7.8](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/7e266b6d-32e5-4201-b687-8ec40c24cd73)
- [EMR_EXTTEXTOUTW, §2.3.5.8](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/a59a79ac-328e-492d-a34d-e02727af6edf)
- [EmrText, §2.2.5](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/dd585d0a-5d7c-4034-963a-1141af836972)
- [Text output options, §2.1.11](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/e7ffcc53-40d1-4873-8eda-c5c5ee104aa5)

Runtime EMF text support now passes this eight-case native bound comparison;
unsupported text modes still fail explicitly. These controls
are evidence for the implementation, not a claim of complete EMF conformance.
Glyph-index input, rotated fonts, background rectangles and complex-script
shaping need additional cases before claiming their support.
