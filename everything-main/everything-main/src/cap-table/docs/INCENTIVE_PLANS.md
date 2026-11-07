# Equity incentive plans

A company keeps its award reserves as plans, each with a name, an adoption
date, the kinds of award it is written for, an optional expiration, a dated
reserve history, and rules for where the shares an award gives back go. An
option grant or RSU award names the plan it draws from, or says it sits
outside every plan. Warrants never draw a plan.

The one company-wide pool the app used to keep is one plan. Nothing it
reported changes.

## Balances

Per plan, as the records stand or as of any past date:

- **Reserve**: the shares the plan itself authorized, net of dated transfers,
  in today's units. This bookkeeping figure can be negative when a plan
  transfers on shares it received through recycling; those inflows offset
  the debit in its authorized balance.
- **Authorized**: the reserve, plus what other plans' rules poured into it,
  less what its own rules poured out.
- **Committed**: what its awards draw. An award draws its quantity on its
  grant date; a later event on the award hands shares back only when the
  plan's rule for that event says so.
- **Available**: authorized less committed. Negative where imported awards
  outran the reserve, which the Share classes page names in words.

The company aggregate is the sum over plans. The fully diluted count adds
every open plan's available shares, none below zero; a retired plan's
available shares are not counted, since nothing can be granted from them.
An award outside every plan counts as fully diluted and draws no reserve.

`company.poolAuthorized` and `company.poolHistory` remain on the record as
the aggregate of the plans, kept in step by the store for everything written
before plans existed.

## Recycling rules

Each plan carries one rule per event, applied to every award under the plan,
past and future:

| Event | Default | Meaning of the default |
| --- | --- | --- |
| Cancellation | return | Unvested awards forfeited on a departure, or cancelled by hand, go back on the shelf. |
| Expiration | return | Options that lapse unexercised when the grant's window closes go back on the shelf. |
| Exercise | retire | Exercised options stay drawn from the reserve. |
| Settlement | retire | Settled RSU units stay drawn from the reserve. |
| Repurchase | retire | Shares from an exercise or settlement the company buys back stay drawn. |
| Transfer | retire | Shares from an exercise or settlement sold on stay drawn. |

A rule is `return`, `retire`, or another plan's id. Naming another plan pours
the shares over: they leave the originating plan's authorized and committed
counts together and arrive in the successor's authorized count, on the day
of the event, once. A forfeiture dated on the day the grant's window closed
is an expiration; any other forfeiture is a cancellation.

A partial cancellation removes only the cancelled quantity from the last
unvested installments. The surviving options or units keep vesting on their
original schedule. Cancelling all unvested units ends future vesting; the
departure flow also records `vestingStoppedAt` explicitly, independent of
the quantity forfeited. Expense reports remove only the forfeited unvested
units on each cancellation date, and retain expense for earned units that
later lapse.

A share can return or pour over only once. After exercise, settlement, or a
transfer has recycled it, a later transfer or repurchase of that share does
not credit a reserve again. Shares retained in a partial transfer can still
be recycled by a later event.

The defaults are the convention the one pool followed. Every movement is
read off the award's own history (its forfeitures, its exercise and
settlement certificates, the repurchases and transfers of the shares those
produced) rather than written down beside it, so an undo, an as-of date, a
split, or a rule change reconciles on its own. A rule change that would leave
a plan with more committed than reserved is refused.

## Dated reserve changes

A plan's `reserveHistory` records, in the order applied and in the units of
each entry's day: the adoption, resizes, round top-ups, transfers between
plans (two entries under one `transferId`, each naming the other plan), and
the restatement a split made (`splitId`, with the exact figure before and
after rounding). Each entry carries a sequence number shared with the
company's splits, so a historical split entered behind a later-dated resize
still reads right on every date.

A transfer moves available shares only: it is held to what the source had on
the day and still has today, and the destination must be open. The company's
total reserve and every holder's ownership are unchanged by it.

## Retirement and amendments

Retiring a plan as of a date closes it to new awards dated after that day
and takes its available shares out of the fully diluted count. Its awards
and history stay. The date cannot precede the plan's latest award or reserve
change. The retirement sheet offers to pour the available shares into a
successor (a dated, linked transfer) and to point every rule that returned
shares to the plan at that successor, so a later forfeiture lands there. A
retired plan can be reopened.

An amendment is held to the awards already granted: the adoption date cannot
move past an award or the first reserve change; the expiration cannot fall
before an award; a kind in use cannot be dropped. A plan nothing refers to
(no awards, no rule naming it, no transfer linking it) can be deleted;
anything else is retired instead.

## Reserve enforcement policy

- The award sheets and store refuse a new or edited award that creates or
  worsens a reserve shortfall on any date. They check the grant date and
  intervening grants, cancellations, exercises and reserve changes; a later
  return or top-up cannot fund an earlier award. Historical comparisons use
  that date's split units. Corrections that leave an imported overrun no worse
  remain allowed. Both layers also refuse a plan that cannot hold the award
  (wrong kind, dated before adoption or after expiration or retirement), and
  the store refuses a plan reference that names no plan.
- The store refuses shrinking a reserve below what is committed, a transfer
  larger than the source's available shares, and a rule change that would
  leave a plan over-committed.
- Imports and backups are taken as written: an award may outrun its plan's
  reserve, and the plans table, the dashboard and the award sheet say by how
  much. The reserve is a budget the app holds new awards to, not a constraint
  it rewrites history to satisfy.

## Migration and imports

- A company record with a pool and no plans reads as one plan under a fixed
  id, with the pool's history as the plan's and the default rules. The plan
  has no recorded adoption date, so any award the pool held is still its own.
  Every award that names no plan draws from it. The plan is written to the
  record on the company's next save, so a load never changes stored data.
- A JSON backup written before plans existed imports the same way. A backup
  with plans keeps them; an award naming no plan takes the one plan that could
  hold it (right kind, dated inside the plan's life). An award several plans
  could hold is refused with its label: set `planId` on it, or `outsidePlan:
  true`.
- CSV securities imports take an optional **Plan** column: a plan's name,
  `none` for an award outside every plan, or blank for the one plan that could
  hold the row. A blank cell two plans could hold is refused, naming them. A
  cell on a share, warrant, SAFE or note row is refused.

## Round closes and forecasts

The round model tops up the company's unallocated count to the target share
of post-round fully diluted. Closing writes the top-up into one plan, chosen
on the close sheet when more than one is open (the most recently adopted
open plan by default), dated the close; every other plan keeps its reserve.
Where the destination's awards had outrun its reserve, the new reserve covers
the overrun as well, so the unallocated count the review promised is the one
the cap table shows.

The hiring plan's forecast draws against the aggregate; with several plans it
also names each plan's own draw against its own available shares, since the
grants come from one plan at a time. A planned role can name its plan.

## History

Plan operations are journaled under their own names (adopting, editing,
resizing, transferring, retiring, deleting a plan; a round's top-up). Reserve
entries and retirement dates supply the effective dates. Plans live on the
company record, so their changes appear as changes to it.
