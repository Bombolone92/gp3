# Main-story font-specific symbols

`tools/body_symbols_fixture.py` manually authors fourteen symbol controls in
ordinary WordprocessingML runs. Surrounding text explicitly uses Arial, while
symbols declare Wingdings, Symbol or Arial independently. Cases include direct
and private-use codes, a missing Arial glyph, caps and small caps.

The reference application supplies `native.pdf`. Capture it with the existing
`tools/export-reference.ps1`, then run `tools/record_body_symbols.ps1`
to record twelve native range observations and seven editing operations in
`native-edited.xml` (in-memory Flat OPC, not a saved DOCX). `reference.json`
hash-binds the original source, PDF and edited XML. Run
`tools/record_body_symbol_positions.py` for the fourteen native line and symbol
origins in `native-positions.json`.

Native findings:

- Direct and private-use Wingdings codes display the same folder symbol.
- Arial F041 is a missing glyph; it must not be blindly converted to ordinary A.
- Font changes and direct-format clearing preserve the explicit `w:sym` face.
  Bold also preserves its identity. Replacement/deletion removes the symbol;
  ordinary text inserted before or after it uses the underlying run font.
- Arial `0061` remains lowercase and full-size under caps and small caps.
- COM exposes the symbol as character 40 and reports the underlying run font.
  This internal COM placeholder is not its visible glyph or DOCX character code.

The editor retains each body symbol as one object position with its original
font/code metadata, uses that font/code for layout and AutoFit, and writes
`w:sym` on export. Plain-text clipboard output carries the encoded character;
plain-text clipboard operations do not carry font metadata. Header/footer
symbols now use the same retained-symbol path; see [page-story controls](../story-symbols/README.md).
Symbols in otherwise unsupported content controls retain those independent guards.

The first combined native recorder consumed CPU without producing its PDF;
its positively identified private helper/reference application instance were stopped. Separate
PDF export and edit recording both completed normally. No application security
settings or unrelated reference application processes were changed.

The earlier Arial label-spacing discrepancy is resolved on current main by
the generic native OpenType/consumer defaults added in 3dfae0fc. The original
C11 symbol origin is now within 0.062pt of the retained native position.
The browser regression requires absolute symbol and following-text positions
for all fourteen controls within its unchanged 0.2pt bound, alongside symbol
advances and baselines. Source/PDF hashes are verified; native character-origin
extraction regenerates the same fourteen reference rows. Set
DOCX_NATIVE_FONTS_REQUIRED=1 for a verification run that must have Arial,
Wingdings and Symbol. Other environments retain the disclosed font-substitution
annotation. Per-line observations and errors are saved with the browser result.
This control does not certify all surrounding text shaping or the original
style-guide corpus document, which still has separate font and field-refresh gaps.

ECMA-376 Part 1 §17.3.3.30 (`sym`) defines the explicit font/character pair.
The direct/PUA behavior confirms the previously recorded reference divergence from
the clause's unconditional F000-offset example; actual font mappings determine
the rendered glyph.
