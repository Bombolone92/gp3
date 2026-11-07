# Independent native script metric controls

`tools/script_device_caps_fixture.py` authors the DOCX directly and deterministically generates
the renamed test fonts. No corpus XML, native document content or proprietary
font binaries are copied. This control has 28 native script rows.

At ppem 83, ascent deltas 0, 4, 8, 16 and 32 produce superscript rises 3.48, 3.96, 3.96, 3.96 and 3.96 pt. The large subscript-offset controls expose a sizing fallback; their script-size variations alone do not establish the positioning clamp.

Run the generator, confirm the exact `controls.docx` path is open using the
reference-application opening helper, then run:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/capture_script_position_metafiles.ps1 -ControlRoot tests/fixtures/script-device-caps
python tools/record_script_device_controls.py --folder script-device-caps
python tools/test_script_device_controls.py
```

The capture tool temporarily registers these original test fonts, opens its
own read-only document in the reference application, records `Range.EnhMetaFileBits`, verifies unchanged
source bytes, closes only its owned reference-application instance, and removes its temporary
font registrations in `finally`. There is no persistent
font installation. `native-capture.json` binds source and native capture hashes;
`reference.json` additionally binds all generated fonts and source inputs.

The recorder checks the exact authored OPC parts, paragraph/run structure,
SFNT checksums and declared metric changes. Glyphs, advances and hint tables
remain unchanged. It accepts only the established EMF records, font styles,
baseline alignment, isotropic 600-unit/inch mapping and contiguous advances.
Frame tolerance covers independently rounded integer extents and .01 mm edges.
Process-private GDI font re-selection verifies the captured LOGFONT resolves to
the expected font tables now; this is not a retrospective dump of the reference application's font
bytes at capture time.

The derivatives use the repository's already reviewed Bebas Neue source,
SHA-256 `08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73`,
under SIL OFL 1.1 (`OFL.txt`). Names, specified OS/2/hhea/VDMX metrics,
checksums and removal of DSIG are the only changes. Corresponding design source:
[Dharma Type revision 686d14af](https://github.com/dharmatype/Bebas-Neue/blob/686d14af640c17af3691c597778f121d840d9051/sources/BebasNeueV2.0%282018%29.glyphs).
See `public/fonts/PROVENANCE.md` for the unmodified font's full provenance.

ECMA-376 Part 1 §17.3.2.42 (`vertAlign`) defines script behavior without a
numeric placement algorithm. OpenType [OS/2 recommendations](https://learn.microsoft.com/en-us/typography/opentype/spec/os2)
and [VDMX device bounds](https://learn.microsoft.com/en-us/typography/opentype/spec/vdmx)
describe the font inputs. These controls establish observed native behavior;
they do not demonstrate a contradiction with the OOXML specification.

`script-offset-size.test.js` checks native reduced sizes from the actual font
metadata. The browser suite checks both painted axes, editing, export/reopen
and byte-exact undo for the two subscript-offset documents. Vertical placement
remains diagnostic: `check_script_device_position.py` uses the reference application's measured
reduced sizes as inputs. A matching diagnostic is not an end-to-end positioning
implementation or certification of other output devices or variable instances.
