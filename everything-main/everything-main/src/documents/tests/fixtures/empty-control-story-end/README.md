# Empty control pointer ownership at the end of the text

These sources are original XML/OPC controls. The middle, leading and trailing
inputs reuse the independently authored `empty-control-home-end` fixtures.
`tools/empty_control_story_end_fixture.py` derives two additional holdouts:
the trailing control followed by a separate `NEXT` paragraph, and a document
containing only the empty control. Its generated package parts match the exact
copies opened in the reference application; ZIP timestamps differ. No corpus artwork or font
binaries are included.

The reference application was operated through its desktop UI on September 29, 2026.
All captures used 500% zoom in a 946 by 536 window. The visible line started
at x=25 and the boundary after A at approximately x=72; y=237 was inside
the line. Saved DOCX outputs, not the absence of visible spaces, establish
control ownership and prompt restoration.

| Case | Native actions | Marker | Saved result |
| --- | --- | --- | --- |
| middle | Click x=75, then x=54, then x=91 | Q | AQD; Q inside |
| trailing-outside | Click x=74, then x=500 | Q | AQ; empty control before Q |
| trailing-inside | Click x=69 | S | AS; S inside |
| trailing-exit | Inside at x=69, then click x=500 | T | A, five-space prompt, T outside |
| leading-inside | Click x=30 | L | LD; L inside |
| leading-near | Inside at x=30, then click x=22 | B | BD; B inside |
| internal-end | Click x=69, then x=500 on the first line | I | AI, then NEXT; I inside |
| empty-outside | Click x=500 on the empty line | E | E; empty control before E |
| fresh-exit | Fresh source, click x=69 then x=500 | F | A, five-space prompt, F outside |
| trailing-drag | From the empty inside state, drag x=69 to x=500 | G | A, five-space prompt, G outside |

For trailing-inside, preceding outside typing was undone before entering.
For trailing-exit, inside S was undone before the exit. For leading-near,
inside L was undone first. The fresh-exit capture repeats the exit on a
freshly opened unmodified source, ruling out those prior edits as a necessary
condition. The drag capture follows two Undo actions after fresh-exit (typing,
then prompt restoration). The internal-end exit was also visually repeated
after undoing inside typing; it retained the inside frame. The saved first
result is the hash-bound native reference for that holdout.

`reference.json` binds source and result bytes, exact text and control content.
Its browser points use offsets and local CSS-pixel displacements corresponding
to the observed native sides of the boundary, rather than absolute UI locations.
`python tools/verify_empty_control_story_end.py` verifies source construction,
artifact hashes and every stored outcome against the saved reference XML.

The native distinction is between the end of the text and an internal paragraph
end. A click on the text side still enters the empty wrapper. A click beyond
the end can put typing after it. Leaving an existing inside caret restores its
prompt even when the logical text offset is unchanged. The explicit outside
ownership must survive the subsequent hit test; otherwise typed text is added
to the prompt and clears its placeholder state. A nearby leading-boundary
click does not establish a corresponding before-control transition.

ECMA-376 Part 1 §§17.5.2.26/31 (`sdt`/`sdtContent`) and §§17.5.2.25/39
(`placeholder`/`showingPlcHdr`) define the retained markup, not these pointer
transitions. This is observed reference editing compatibility, not a contradiction
of a normative mouse-selection algorithm. Shift-click and other unverified
control interactions remain separate work; these controls do not complete #137.

The browser tests verify native text and ownership at two zooms, preserved
package parts, export/reopening, exact undo/redo, and read-only behavior.
Modified clicks and drag releases retain their existing non-restoring path
at the same offset; no native modifier rule is inferred from ordinary clicks.
On baseline main, the trailing-outside test fails: Q is inside the wrapper
instead of after an empty wrapper, despite identical visible text `AQ`.
