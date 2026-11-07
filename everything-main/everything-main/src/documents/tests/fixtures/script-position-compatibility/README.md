# Script position and compatibility mode

These controls isolate one possible cause of the remaining script-baseline
defect in corpus #252. The original `script-size/control.docx` is manually
authored. Both copies retain every package part exactly, apart from the single
compatibility-mode value in `word/settings.xml`. Mode 15 is identical to the
original at the package-part level; mode 12 changes only that value.

The reference application confirmed CompatibilityMode 12 and 15 respectively. A separate
read-only capture produced nine range EMFs for each input and exited normally.
The 108 face/size/script combinations have **identical positions and font
heights in both modes**. Both captures agree with the original mode-15 PDF;
the largest relative-baseline difference is 0.02pt from PDF serialization.
Thus a mode-12/mode-15 distinction does not explain these script discrepancies.
This is not a claim that compatibility mode never affects typography.

Reproduce locally on Windows with the already authorized installed fonts:

```text
python tools/script_position_compatibility.py --generate
powershell -NoProfile -File tools/capture_script_compatibility.ps1
python tools/script_position_compatibility.py
```

The generator copies only the existing original OPC parts; it does not use
the reference application or the viewer to author content. Generation may change ZIP timestamps,
so the verifier compares complete uncompressed parts. The recorder binds all
inputs and native captures by hash and checks the old source/PDF hash before
using its reference. It verifies the EMF physical mapping, GetDC interval,
baseline alignment, exact text sequence, font family, weight, italic flag,
normal size and adjacent advances before measuring relative positions.

Regular, bold and italic Garamond, Arial and Times New Roman are used by name.
No installed font bytes are copied, registered or redistributed. The EMFs
contain native drawing records and LOGFONT descriptions, not embedded fonts.
They do not provide retrospective font-table identity inside the reference application; the older
PDF reference additionally checks its emitted PostScript face names.

Local validation: 216 extracted native rows, 108 exactly equal mode pairs,
six source XML schema checks, and three existing script-reference unit tests
pass. The strengthened extractor also replays the prior 56 OFL-control rows
without changing their committed reference; all 42 of those private-font
reselection checks still pass. Generic inspector output remains unchanged
across all 32 native captures, and an intentionally substituted upright face
in the italic Arial control is rejected.

ECMA-376 Part 1 §17.3.2.42 defines `w:vertAlign`; this observation supplies no
new normative placement formula or demonstrated standards conflict. The
general script-position calculation is still unresolved. No application,
dependency or corpus completion status changes are included.
