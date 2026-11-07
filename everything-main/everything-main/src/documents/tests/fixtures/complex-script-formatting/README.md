# Forced complex-script face and italic controls

Original XML from `tools/complex_script_formatting_fixture.py`; only the OPC
skeleton is reused from our original RTL fixture. Eighteen cases compare cs/rtl,
plain/italic/bold-italic, and Arial/Courier New/Times New Roman. Each uses ordinary
Arial 10pt and a declared complex-script family at 16pt, with Latin, European
digits and an Arabic-Indic zero. No corpus material or font binary is included.

The reference application exported the three-page PDF. All three native pages
were inspected. `record_complex_script_formatting_reference.py` records glyph
origins, bounds, fonts, sizes, weights and transformation matrices, hashes the
source/PDF/cases/raster, and extracts the ABC words into a 288dpi contact sheet.

The reference application uses real italic faces for forced cs Latin text. For rtl it uses the upright
face with text-matrix c=0.3333, including when installed italic faces exist.
The shared painter implements this baseline-relative shear without changing
advances. The browser test uses native origins to isolate font/paint behavior;
it does not claim paragraph bidi ordering or caret support. Source import with
active flags remains guarded. A separate browser case covers editable off flags.

Native/CSS rasterization is not identical: Courier's upright thin strokes differ
by about 8% total ink even without synthetic italics. Tests retain the measured
differences, bound total ink, compare glyph origins, verify native font/matrix
choices, and require RTL shear to substantially improve on real-italic ink.

Still open: in these cs italic cases the reference application falls back to sheared Tahoma for the
Arabic-Indic zero, unlike the Latin face. In the earlier rtl-runs controls a
European-number-only run uses Arial despite cs=Courier New, whereas the mixed
run here uses Courier New throughout. Font choice needs script/context handling;
neither a per-document override nor a blanket per-digit font exception is valid.
