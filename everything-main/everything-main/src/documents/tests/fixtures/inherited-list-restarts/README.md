# Numbering instance continuation and restarts

Original source: `tools/inherited_list_restarts_fixture.py`; all examples and XML
are authored for this project. The reference application exported `native.pdf` from the
schema-valid source. `reference.json` records every printed marker in page
order. The manifest hashes the source and references.

The eighteen cases cover linked/unlinked paragraph styles, inherited child
styles, direct numbering without a style, starts at 1 and 7, no override,
returning to earlier instances, different abstract definitions, intervening plain
paragraphs, table boundaries and multilevel parent/child restarts.

The reference application shares counters across instances referencing the same abstract definition.
A first encounter with a new instance applies its start override only at the
current paragraph level. Reusing that instance does not apply the override again.
A parent-level paragraph resets subordinate levels using that parent's instance
properties. Thus case 16 returns to an instance with a child override of 5 but
prints 2.1 after a parent from the base instance; case 17 prints 2.5 after a parent
from the overriding instance, even though the child uses the base instance.

Relevant clauses: ECMA-376 Part 1 §§17.9.16 (num), 17.9.18 (numId), 17.9.23
(pStyle), 17.9.26 (startOverride), and 17.9.11 (lvlRestart). The unique instance
references do not translate into independent counters in the reference application. The captured
cross-instance reset behavior is documented as an interoperability distinction
from a per-instance reading of those declarations; the source declarations remain
unchanged. This is not a template-specific numbering rule.
