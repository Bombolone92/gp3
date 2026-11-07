# Bracketed numeric input

Original XML from `tools/script_input_brackets_fixture.py`; 40 cases compare
forced cs and rtl contexts, bracketed numbers, surrounding Hebrew/Arabic/Latin,
and ordinary numeric separators. Record with `tools/record-script-input.ps1
-Root tests/fixtures/script-input-brackets` (from the repository root).

The reference application treats a bracketed weak/neutral-only sequence as a neutral script item.
Surrounding strong text or the input context determines its flags. This differs
from applying the final display embedding level to every numeric character.
The implementation uses Unicode bracket pairing and a bounded stack, not
literal template text or a font-specific adjustment. Brackets containing strong
text retain the ordinary bidi resolution path.

The original and native files and case list are hash-bound. All 40 native flag
outcomes are checked by `tests/script-input.test.js`. Native document.xml has
the same published hint="cs" electronic-schema omission documented in the
script-input fixture; the source and application exports pass schema checks.
Input-language, IME and automatic font/language assignment are outside this
flag-only native comparison.
