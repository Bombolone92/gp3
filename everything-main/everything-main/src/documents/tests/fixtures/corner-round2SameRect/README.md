# Paired rounded-corner rectangle

Original controls generated with `python tools/corner_preset_fixture.py round2SameRect`
from the project's original shape-defaults package. Eight shapes cover defaults,
zero radii, unequal top/bottom radii, maximum radius, negative/excessive clamps,
a conflicting portrait inner transform, rotation and both flips. Three contain
Arial text. No external template artwork or fonts are bundled.

The reference application exported `native.pdf` using
`tools/export-reference.ps1`. `tools/corner_preset_reference.py round2SameRect`
records 4,485 independently sampled native ink locations and three text origins,
bound to the source and PDF hashes. Browser tests verify every ink sample, text
origins (maximum X error .093pt, baseline error .136pt), editable export/reopen,
unchanged shape markup and exact package restoration on undo.

The governing definition is ECMA-376 Part 1's supplied
`OfficeOpenXML-DrawingMLGeometries/presetShapeDefinitions.xml`, `round2SameRect`;
see also §§20.1.9.18, 20.1.9.11 and 20.1.10.56. Top and bottom radii are separately
clamped to half the shorter side. Horizontal text insets use the larger radius;
top/bottom insets use their respective radii, all multiplied by .29289.
No reference/spec divergence was found in these controls. The engine implementation
is original and does not ship copied third-party geometry code.
