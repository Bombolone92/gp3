# AutoFit rounding at a content minimum

Original manually authored OOXML: twelve single-row AutoFit tables use three,
four or five columns and table preferences 3000, 3001, 3600 or 3601 twips.
Cell preferences are 500 twips followed by 1250 twips per remaining column.
All margins are zero; text is Arial 9pt with exact 12pt line spacing. The first
cell contains “Receivables”; the others contain single letters. No template
content or reference-authored table XML was copied into this control.

The reference application exports every cell on one line. The previous engine wrapped
the first word in cases C004 and C008: its continuous AutoFit allocation met
the word minimum, but balancing rounded columns took one twip away. The fix
preserves feasible per-column minima while retaining the total table width.
This does not claim a complete model of rounding merged-span constraints.

`native.pdf` is a fresh native reference export. `reference.json` records source
and PDF SHA-256 and all 48 native cell text origins/baselines (points). The
browser regression checks text, page, positions within 0.2pt, and no-edit,
edit/unrelated-part, undo and reopen behavior. `cases.json` lists the authored
table parameters. The native comparison is independent of engine predictions.
