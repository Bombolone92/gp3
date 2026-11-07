# Private-use numbering with complex-script properties

Eight original controls authored by tools/symbol_cs_numbering_fixture.py. Symbol
U+F0B7 and Wingdings U+F0A7 each have a baseline, bCs enabled, iCs enabled and
szCs=96 (48pt) case. Ordinary marker size is 11pt. Body text uses Arial 11pt with
exact 24pt lines in compatibility mode 15. No corpus content or fonts are bundled.

The reference application preserves the ordinary size and appearance of both private-use
glyphs in all four cases. The PDF reports the same quantized 11.04pt size for
every marker. Complex-script properties are inactive for these ordinary symbol
glyphs; their presence does not make the label a complex-script sequence. The
importer still validates those properties and rejects unsupported script labels.
The existing Symbol mapping and private-use font selection remain unchanged.

The reference generator records native text origins and marker sizes, renders
the page and binds source/PDF hashes. Native and browser glyphs were visually
inspected. Browser checks cover origins within 0.15pt, hit targets, insertion,
package preservation, export/reopen and exact undo. Units also reject malformed
complex-script values and retain the unsupported Arabic-label guard. This does
not implement active complex-script numbering or certify arbitrary fonts.
