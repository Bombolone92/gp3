# Empty-control extended selection

The source is the existing independently authored XML/OPC A + empty rich-text control + D fixture from `../empty-control-home-end/control.docx`. No corpus artwork or fonts are copied. `reference.json` binds the original and seven native DOCX results by SHA-256; `tools/verify_empty_control_shift_selection.py` verifies their text, control contents and placeholder flags.

The reference application was operated through the desktop UI on September 29, 2026, at 500% zoom. In the 946x536 window, the line begins at x=25. Clicking x=69,y=237 enters the empty wrapper, confirmed by its frame. Markers below were entered with a physical x key.

| Case | Keys after entering the empty wrapper | Saved native result |
| --- | --- | --- |
| right | Shift+Right, x | AxD; x inside |
| continued | Shift+Right, x, Undo, Shift+Right, x | Ax; x inside |
| twice | Shift+Right, Shift+Right, x | Ax; x inside |
| left | Shift+Left, x | AxD; x inside |
| left-continued | Shift+Left, x, Undo, Shift+Left, x | x, five spaces, D; spaces inside, placeholder false |
| left-restored | Shift+Left, Shift+Left, Save | A, five spaces, D; spaces inside, placeholder true |
| left-twice | Shift+Left, Shift+Left, Save, x | x, five spaces, D; spaces inside, placeholder false |

The first two references were captured in `empty-shift-selection-native.docx`. During initial setup the text-paste helper inserted unrelated clipboard text instead of its requested marker. It was immediately undone. The recorded first result was then repeated from an empty source state after an explicit inside click, using physical key input only. Neither saved result contains the unintended text. The continued result follows undo of the recorded first marker.

The other five references came from a fresh source copy, `empty-shift-holdouts.docx`. The twice case had no intervening typing/undo, establishing the continuation behavior independently. Before the left case, replacement and restoration were undone and the inside caret explicitly re-entered. The left continuation follows undo of its marker. For left-restored and left-twice, replacement/restoration were again undone and the inside caret explicitly re-entered. Save preserves the selection; the intermediate DOCX establishes that extension restores a real placeholder, and typing beside it subsequently clears that flag while retaining its spaces. The native probe window was closed after saving.

## Selection behavior

The first extended arrow crosses a zero-length control boundary without consuming a neighboring character. A second arrow in the same direction restores the prompt and extends the text selection while retaining its original anchor offset. Thus a forward selection includes the restored prompt, while a backward selection stops at its leading edge. Typing follows the selection's control ownership. An unconditional Shift+Arrow no-op or symmetric prompt selection would fail the holdouts.

Selection-boundary metadata is distinct from the collapsed caret and stays out of DOCX. Browser tests compare native text/ownership at two zooms, preserve unrelated package parts, reopen outputs, and check exact full undo and redo. The source/native validator and schema checks are complementary evidence, not full the reference application or OOXML certification.

## Baseline and scope

On main 7730ded6 both original browser sequences return Ax with an empty control. The first loses D prematurely; the continuation has incorrect ownership despite matching visible text. The original expected-failure reproductions were committed in 69022bc6. Two initial navigation timeouts preceded unchanged retries reaching those intended failures. The implementation now exercises ordinary passing native comparisons; failures are not hidden by an expected-failure annotation.

The markup is ECMA-376 Part 1 §§17.5.2.26/31 (sdt/sdtContent) and §§17.5.2.25/39 (placeholder/showingPlcHdr). Those clauses do not prescribe a keyboard-selection algorithm. This is reference interaction compatibility, not a normative spec contradiction. General Shift-click, nonempty/adjacent-control selections, and all selection-cancellation protocols remain separate review work. Corpus document #137 stays partial. The available native automation API has no held-modifier click, so Shift-click has not been inferred from these keyboard controls.
