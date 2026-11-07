# Direct indentation with cancelled numbering

Original source: `tools/numbering_cancel_indent_fixture.py`; native export:
the reference application. Ten pages pair uncancelled/cancelled numbering with no direct
indent, direct left, direct right, direct first-line and all three overrides.
The paragraph style declares left/right/first-line = 18/12/6 points. Direct
overrides are 30/24/9 points. The unchanged source and PDF are hash-bound by
`tools/numbering_cancel_reference.py`, which records native image positions.

The reference application's native paragraph formatting reports (left, right, first-line), in points:

```
18 12 6; 30 12 6; 18 24 6; 18 12 9; 30 24 9
 0 12 0; 30 12 0;  0 24 0;  0 12 9; 30 24 9
```

The first row has no cancellation; the second has direct `numId=0`. Inherited
right indentation survives. Direct left/first-line overrides survive separately.
See the companion `numbering-cancel-indent` controls for centered body/cell
geometry and the specification observation.
