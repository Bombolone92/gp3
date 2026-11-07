# Negotiated financing terms

Terms are structured inputs, not interpretations of agreement prose. Each right,
MFN election and preferred amendment names its agreement and effective date.
Unknown fields or conventions are refused rather than discarded. Dates use UTC
calendar days; effective dates are inclusive, eligibility end dates inclusive.

References: [YC SAFE guide](https://www.ycombinator.com/safe) and its worked
post-money conversion examples; [NVCA model documents](https://nvca.org/model-legal-documents/).
These are convention references, not a claim that every variant of either form
is supported. Match the actual signed agreement before selecting a convention.

## Pro rata

A right belongs to the holder of the named instrument. Fixed-percentage rights
use the recorded fraction. Pre-round FD uses that holder's existing diluted
shares divided by pre-round FD, including unallocated reserves. YC post-money
side-letter participation uses the named SAFE's conversion shares divided by
company capitalization before new money and the round's new pool. Original YC
rights apply in a subsequent round after the named SAFE has converted, using
its holder's then-current diluted ownership. They do not apply in its conversion
round. Promised options and bespoke denominator exclusions are unsupported.

In a fixed $2,000,000 round a 10% right has a $200,000 maximum. Elections of
$200,000, $100,000 and $0 leave $1,800,000, $1,900,000 and $2,000,000 for others.
With 900,000 founder shares, 100,000 investor shares and $8m pre-money, price is
$8 and the full election adds 25,000 investor shares. Ownership is 10%; a half
check adds 12,500 shares and yields 9%; zero yields 8%.

In additional mode the entered raise excludes the elected checks: a $200,000
check increases that $2m raise to $2.2m. Entitlement is measured against the
resulting total. Explicit dollar elections determine that total before solving
price, SAFE/note conversions, anti-dilution and pool top-ups. Over-entitlement
and overallocated fixed rounds cannot close. All checks round independently to
whole shares; cash versus issued-share value differences are reported.

## MFN

Only explicit elections of valuation cap, discount and SAFE money convention
are supported. Sources must be later, within the eligibility window and one
of the recorded eligible instrument kinds. Terms are copied into the election
with source date and agreement evidence; editing the source later cannot alter
that election. Original instrument fields remain intact. A scenario explicitly
selects election IDs and a financing ID; only eligible dated elections apply.
Overlapping elections for one instrument are refused. For example, a $100,000
pre-money SAFE with an $8m cap can elect a later $5m cap. On 1m pre-round shares,
the cap leg becomes $5 instead of $8 only for scenarios selecting that election.

## Preferred dividends and participation caps

Amendments form an append-only, strictly dated history. Caps are multiples of
original invested dollars, with explicit inclusion/exclusion of the initial
preference and accrued dividends. Caps constrain residual participation, never
reduce the senior preference owed. After a cap binds, the remaining proceeds
are redistributed to uncapped participants. Each class chooses between the
contractual preferred leg and conversion, considering the other classes' choices.

Example: 1m common shares and 1m preferred bought for $1m, 1x participating,
3x cap including preference. At $4m proceeds preferred receives $2.5m; at $6m it
receives its $3m cap; above $6m conversion pays more (at $8m, $4m). Shortfalls
pay higher seniority first and equal ranks proportionately.

Dividends use actual elapsed days / 365, and so does the simple interest a
convertible note accrues to its conversion or an exit. Simple accrual is principal × annual
rate × elapsed years; compound uses (principal + unpaid balance) ×
((1 + rate)^years − 1), resetting at amendments and dated cash events.
Non-cumulative dividends accrue nothing automatically: only explicit declarations
create a claim. Payments reduce accrued/declared balances on their date; a
payment more than half a cent over the balance is refused. A $1m basis at 8% simple accrues $80,000 in 365 days;
a $30,000 payment then leaves $50,000. Two 365-day years at 8% compound accrue
$166,400. Dividends either add after the preference multiple or enter its basis,
and are explicitly forfeited or retained as cash on conversion. They share the
class's seniority and shortfall scaling. Dividends do not themselves mint shares.
Original principal and accrual date follow certificates through splits and
proportional transfers, so reverse-split rounding does not rewrite the basis.

Supported exit elections are reconciled by enumerating up to 12 preferred
classes with new terms. Larger stacks, or advanced preferred terms combined
with unconverted SAFEs, return an actionable unsupported result. Notes retain
senior debt repayment. No unstable or unverified election is returned as a payout.

## Reproducibility and closing

Saved scenarios retain their model date, inputs and elections, and a fingerprint
(`basisDigest`) of the cap table they were saved against: the company record,
classes, holders and securities, hashed with their keys sorted. A loaded scenario
whose fingerprint no longer matches the live table says so; its figures follow
the live table, and the round cannot be closed until the scenario is saved
again, which refreshes the fingerprint. Closing a modeled round is held to the
model: the store re-runs it on the closing date against the live table, refuses
when the fingerprint, the date, a confirmed check, a conversion, an anti-dilution
adjustment or the pool top-up differs from what the model says, and stamps every
certificate with the financing ID, the assumptions it was priced under, the
pro-rata right it satisfies or the MFN election applied to its source. A repeated
close with the same financing ID is rejected. Terms and elections use the
permanent audit ledger through ordinary class, security, scenario and round
transactions. JSON backups include all terms. Optional structured JSON columns in
security CSV imports preserve rights, MFN clauses, dividend events and the
economic basis. Export financing terms produces a term report; full relational
restoration (including classes, scenarios and source IDs) uses the JSON backup.
