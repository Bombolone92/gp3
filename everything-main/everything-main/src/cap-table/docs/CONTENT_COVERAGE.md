# Public content coverage

This inventory defines documentation coverage for the current user-facing app. It is not a claim that the software implements every equity, accounting, or legal workflow. A covered feature needs instructions, expected results, important limitations, and a recovery or review path. Unsupported behavior is documented explicitly.

## Coverage scope and result

The September 13, 2026 source review covers all 11 top-level app views and the forms they open. The library contains 44 documentation articles and 35 concept guides. All 79 articles are listed in this inventory and are reachable through their collection hub, category navigation, and related reading or in-article links.

View coverage is 11/11 (100%): Home, Cap table, Securities, Stakeholders, Share classes, Round modeling, Exit scenarios, Needs attention, Reports, History, and Settings. This measures whether each view's workflows are documented. It does not measure every possible user question, certify legal accuracy, or imply that a link alone establishes complete coverage. The detailed workflow audit below records the actions and consequences checked against source.

## Feature map

| Feature and implementation | Public documentation | Concepts or review |
| --- | --- | --- |
| Sign-in, sample data, setup (`src/views/auth.js`, `src/ui/onboarding.js`) | [Getting started](/docs/getting-started/) | [What is a cap table?](/guides/what-is-a-cap-table/) |
| Company selector, profiles, currency, themes, deletion (`src/ui/shell.js`, `src/views/settings.js`) | [Workspaces and documents](/docs/workspace-and-documents/) | [Recovery](/docs/troubleshooting-and-recovery/) |
| Home metrics, chart, calendar, search (`src/views/dashboard.js`, `src/ui/search.js`) | [Dashboard and search](/docs/dashboard-and-search/) | [Attention items](/docs/resolving-attention-items/) |
| Holders and statements (`src/views/stakeholders.js`, `src/views/stakeholder.js`) | [Stakeholders](/docs/managing-stakeholders/) | [Maintenance checklist](/guides/cap-table-maintenance-checklist/) |
| Ownership bases, as-of dates, exports (`src/views/captable.js`) | [Historical cap table](/docs/reading-a-historical-cap-table/) | [Share counts](/guides/authorized-outstanding-and-fully-diluted-shares/) |
| Shares, options, RSUs (`src/ui/securityform.js`) | [Shares and grants](/docs/recording-shares-and-grants/) | [Award comparison](/guides/options-rsus-and-restricted-stock/) |
| ISO/NSO fields, early exercise, election records (`src/ui/securityform.js`, `src/ui/attention.js`) | [Exercises](/docs/exercising-options/), [Attention items](/docs/resolving-attention-items/) | [ISO and NSO](/guides/iso-and-nso-options/), [Early exercise and 83(b)](/guides/early-exercise-and-83b/) |
| Exercise, certification, cancellation (`src/ui/grantactions.js`) | [Option lifecycle](/docs/exercising-options/) | [Form 3921](/docs/form-3921-report/) |
| RSU settlement and cancellation (`src/ui/grantactions.js`) | [RSU lifecycle](/docs/settling-and-cancelling-rsus/) | [Award comparison](/guides/options-rsus-and-restricted-stock/) |
| Warrants (`src/ui/securityform.js`, `src/ui/attention.js`) | [Warrants and workflow limits](/docs/managing-warrants/) | [Calculation scope](/docs/calculation-methods-and-limits/) |
| Regular/custom vesting, acceleration (`src/ui/securityform.js`, `src/lib/captable.js`) | [Advanced vesting](/docs/advanced-vesting/) | [Vesting and pools](/guides/vesting-and-option-pools/), [Acceleration](/guides/vesting-acceleration/) |
| Transfers and repurchases (`src/ui/transfer.js`) | [Transfers and repurchases](/docs/transferring-and-repurchasing-shares/) | [Historical reports](/docs/reading-a-historical-cap-table/) |
| Departures (`src/ui/departure.js`) | [Departure workflow](/docs/recording-a-departure/) | [RSU follow-up](/docs/settling-and-cancelling-rsus/) |
| Common/preferred rights, dated participation caps and dividend terms (`src/views/classes.js`, `src/ui/financingterms.js`) | [Share classes](/docs/configuring-share-classes/) | [Anti-dilution](/guides/anti-dilution-protection/), [Preferences](/guides/liquidation-preferences-explained/), [Common and preferred](/guides/common-and-preferred-stock/) |
| Dated dividend amendments, accrual, declarations and payments (`src/ui/financingterms.js`, `src/lib/financing.js`) | [Preferred dividends](/docs/recording-preferred-dividends/) | [Dividend concepts](/guides/preferred-dividends-explained/) |
| Model and close refusals: pricing, elections, blocked dates, allocation (`src/views/rounds.js`, `src/ui/closeround.js`, `src/lib/financing.js`) | [Financing refusals](/docs/resolving-financing-refusals/) | [Round modeling](/docs/modeling-a-funding-round/) |
| Negotiated-terms export and its CSV columns (`src/lib/financing.js`, `src/lib/csvimport.js`, `src/views/securities.js`) | [Review securities](/docs/reviewing-securities/), [Field reference](/docs/csv-field-reference/) | [Pro rata](/guides/pro-rata-rights-explained/), [MFN](/guides/mfn-clauses-explained/) |
| Plan creation, movements, reserve changes, transfers, recycling, retirement/reopening (`src/ui/planform.js`) | [Equity plans](/docs/managing-equity-plans/) | [Vesting and pools](/guides/vesting-and-option-pools/) |
| Stock splits (`src/ui/split.js`) | [Stock splits](/docs/recording-a-stock-split/) | [Calculation conventions](/docs/calculation-methods-and-limits/) |
| Hiring forecast and grant creation (`src/ui/hiringplan.js`) | [Hiring plans](/docs/planning-hiring-grants/) | [Pool forecast example](/guides/option-pool-hiring-forecast/) |
| SAFE/note records, interest, maturity, pro-rata rights, MFN clauses and elections (`src/ui/securityform.js`, `src/ui/financingterms.js`, `src/ui/attention.js`) | [Convertible instruments](/docs/recording-convertible-instruments/) | [SAFE and note concepts](/guides/safes-and-convertible-notes/) |
| Financing model, dated assumptions, pro-rata and MFN elections, scenarios (`src/views/rounds.js`, `src/lib/financing.js`) | [Round modeling](/docs/modeling-a-funding-round/) | [Dilution](/guides/understanding-equity-dilution/), [Valuations](/guides/pre-money-and-post-money-valuation/) |
| Close allocations, confirmed pro-rata checks, conversions, pool top-up, model reconciliation (`src/ui/closeround.js`) | [Closing a round](/docs/closing-a-funding-round/) | [Diligence checklist](/guides/financing-diligence-checklist/) |
| Exit waterfall, participation caps, dividend claims, assumptions (`src/views/exit.js`, `src/lib/financing-waterfall.js`) | [Exit modeling](/docs/modeling-an-exit/) | [Liquidation preferences](/guides/liquidation-preferences-explained/) |
| Valuation history (`src/ui/valuationform.js`, `src/views/settings.js`) | [409A records](/docs/recording-valuations/) | [Valuation and expense](/guides/stock-compensation-and-valuation/) |
| Reporting assumptions, stock compensation (`src/ui/reportingform.js`, `src/lib/reports.js`) | [Stock compensation report](/docs/stock-compensation-report/) | [Valuation and expense](/guides/stock-compensation-and-valuation/) |
| Rule 701 (`src/views/reports.js`, `src/lib/reports.js`) | [Rule 701 report](/docs/rule-701-report/) | [Scope and limits](/docs/calculation-methods-and-limits/) |
| Form 3921 (`src/views/reports.js`, `src/lib/reports.js`) | [Form 3921 supporting data](/docs/form-3921-report/) | [ISO and NSO](/guides/iso-and-nso-options/) |
| Attention resolution and bulk cancellation (`src/ui/attention.js`) | [Attention items](/docs/resolving-attention-items/) | [Recovery](/docs/troubleshooting-and-recovery/) |
| Attachments (`src/ui/attachments.js`) | [Workspace and documents](/docs/workspace-and-documents/) | [Backups](/docs/exports-and-history/) |
| CSV parsing, mapping, plan resolution (`src/lib/csvimport.js`, `src/ui/csvimport.js`) | [CSV workflow](/docs/importing-a-cap-table/), [Field reference](/docs/csv-field-reference/) | [Maintenance checklist](/guides/cap-table-maintenance-checklist/) |
| Backup import, restore points, audit history (`src/views/settings.js`, `src/views/history.js`) | [Exports and history](/docs/exports-and-history/), [Recovery](/docs/troubleshooting-and-recovery/) | [Diligence](/guides/financing-diligence-checklist/) |
| Conflicts, interrupted writes, limits (`src/lib/store.js`) | [Recovery](/docs/troubleshooting-and-recovery/), [Limits](/docs/calculation-methods-and-limits/) | [Workspace context](/docs/workspace-and-documents/) |

## Detailed workflow audit

The broad feature map above is supplemented by these checks. Each row identifies the user actions or interpretation that needed detailed treatment, including operations that save immediately, change linked records, or differ between views.

| Audited workflow and source | Instructions or explanation |
| --- | --- |
| Desktop sidebar, mobile tabs and More, global search, keyboard result selection, dialog closure, table scrolling (`src/ui/shell.js`, `src/ui/search.js`, `src/ui/modal.js`) | [Navigation and shortcuts](/docs/navigation-and-shortcuts/), [Dashboard and search](/docs/dashboard-and-search/) |
| Company creation, retry after naming failure, profile fields, duplicate company names, currency formatting without conversion (`src/ui/companyform.js`, `src/views/settings.js`, `src/lib/format.js`) | [Company profile and currency](/docs/company-profile-and-currency/) |
| Theme selection, standalone sign-out, Puter account context, sample reset, working-data wipe, company deletion (`src/views/auth.js`, `src/ui/onboarding.js`, `src/views/settings.js`) | [Getting started](/docs/getting-started/), [Workspace and documents](/docs/workspace-and-documents/), [Restore company data](/docs/restoring-company-data/) |
| Capital-raised and implied-valuation definitions; future-dated register records versus dated ownership (`src/views/dashboard.js`, `src/lib/captable.js`) | [Dashboard and search](/docs/dashboard-and-search/), [Reconcile a cap table](/guides/reconciling-a-cap-table/) |
| Instrument filters, chronological listing, closed records, per-row edit and lifecycle actions (`src/views/securities.js`) | [Review securities](/docs/reviewing-securities/) |
| All six security forms, inline holder creation, plan defaults, class selection, classification, expiration, liquidity condition, vesting, cap and discount (`src/ui/securityform.js`) | [Security field reference](/docs/security-field-reference/), [Advanced vesting](/docs/advanced-vesting/) |
| Edits, optional correction reason, record-history link, quantity/date dependency refusals (`src/ui/securityform.js`, `src/lib/store.js`) | [Correct and delete records](/docs/correcting-and-deleting-records/) |
| Exercise-certificate deletion leaves the exercise recorded; RSU-certificate deletion restores unsettled units; conversion-certificate deletion reopens the convertible (`src/views/securities.js`, `src/lib/store.js`) | [Correct and delete records](/docs/correcting-and-deleting-records/) |
| Transfer successor deletion, sibling reversal, onward-transfer restrictions, stakeholder cascade deletion, limited Undo (`src/views/securities.js`, `src/views/stakeholders.js`) | [Correct and delete records](/docs/correcting-and-deleting-records/), [Transfers and repurchases](/docs/transferring-and-repurchasing-shares/) |
| Same-name holder warning, profile edits, former-name activity matching, contact email without invitation (`src/ui/stakeholderform.js`, `src/views/stakeholder.js`) | [Manage stakeholders](/docs/managing-stakeholders/) |
| Company print report, both ownership bases, date/pool treatment, individual statement scope, browser PDF, multi-section CSV (`src/views/captable.js`, `src/views/stakeholder.js`) | [Print cap tables and statements](/docs/printing-cap-tables-and-statements/) |
| History record/actor/action/transaction/UTC filters, pagination, before/after fields, full JSON, baseline, source archive, outcomes, unfiltered exports (`src/views/history.js`, `src/lib/audit.js`) | [Transaction history](/docs/transaction-history/) |
| Attachment upload, size limit, immediate saves, preview versus download, pop-up handling, removal, record/file deletion choices, backup manifest (`src/ui/attachments.js`, `src/lib/store.js`) | [Manage attachments](/docs/managing-attachments/) |
| Backup import destination, new-company retry, retained restore-point selection/deletion, snapshot retention, verification, permanent History retention (`src/views/settings.js`, `src/lib/store.js`) | [Restore company data](/docs/restoring-company-data/) |
| Scenario save/load, case-insensitive same-name update, distinct comparison names, delete/Undo, search deep links, recalculation against current records (`src/views/rounds.js`, `src/views/exit.js`) | [Manage saved scenarios](/docs/managing-saved-scenarios/) |
| Class rights and dependencies, closed-certificate references, original versus adjusted conversion price (`src/views/classes.js`) | [Configure share classes](/docs/configuring-share-classes/), [Anti-dilution protection](/guides/anti-dilution-protection/) |
| Reserve total versus increment, movement ledger/export, return/retire/pour-over rules, informational rows, split units, negative availability (`src/ui/planform.js`, `src/lib/captable.js`) | [Reconcile plan balances](/docs/reconciling-plan-balances/) |
| First-plan assignment of existing awards, accepted award types, dated transfers, retirement, reopening removes retirement date, plan deletion restrictions (`src/ui/planform.js`) | [Manage equity plans](/docs/managing-equity-plans/), [Reconcile plan balances](/docs/reconciling-plan-balances/) |
| Hiring role add/edit/delete, shares versus percentage, destination/default plan, forecast limits, issuance leaves the forecast row in place (`src/ui/hiringplan.js`) | [Plan hiring grants](/docs/planning-hiring-grants/) |
| Regular cadence and custom schedule, separate restricted-share vesting start, prior exercises/settlements, single/double acceleration (`src/ui/securityform.js`, `src/lib/captable.js`) | [Advanced vesting](/docs/advanced-vesting/), [Vesting acceleration](/guides/vesting-acceleration/) |
| Option exercise with/without certificate, certification later, early exercise, cancellation, departure deadlines; RSU settlement/cancellation (`src/ui/grantactions.js`, `src/ui/departure.js`) | [Option exercises](/docs/exercising-options/), [RSU lifecycle](/docs/settling-and-cancelling-rsus/), [Departure](/docs/recording-a-departure/) |
| Note extension/maturity resolution, expired-grant bulk cancellation, departed awards, warrant limits, election status, expired plans, valuation follow-up (`src/ui/attention.js`) | [Attention items](/docs/resolving-attention-items/), [Convertible instruments](/docs/recording-convertible-instruments/), [Warrants](/docs/managing-warrants/) |
| Report assumption editing, full-year/quarter selection, Rule 701 rolling windows, Form 3921 year/certificate gaps, CSV scope and fallback notes (`src/views/reports.js`, `src/ui/reportingform.js`) | [Stock compensation](/docs/stock-compensation-report/), [Rule 701](/docs/rule-701-report/), [Form 3921](/docs/form-3921-report/) |
| Numeric entry, whole shares, percentage units, effective/recorded dates, current versus historical split units, rounded display (`src/lib/util.js`, `src/lib/format.js`, `src/ui/split.js`) | [Dates, numbers, and rounding](/docs/dates-numbers-and-rounding/) |
| Exercise spread lines: dated FMV, bargain element, ISO AMT versus NSO income, qualifying-disposition date, missing-409A wording (`src/ui/grantactions.js`, `src/views/stakeholder.js`) | [Option exercises](/docs/exercising-options/), [409A valuations](/guides/409a-valuations-explained/) |
| ISO annual-limit measurement by first-exercisable year, early-exercise treatment, strike fallback (`src/lib/captable.js`, `src/ui/securityform.js`) | [ISO $100,000 limit](/guides/iso-100k-limit/) |
| Post-termination window default, cleared deadline, term versus window expiry wording (`src/ui/departure.js`, `src/lib/captable.js`) | [Exercise windows](/guides/post-termination-exercise-windows/) |
| Expense attribution: straight-line versus graded recognition, forfeiture reversal, remaining period (`src/lib/reports.js`) | [Attribution](/guides/expense-attribution-straight-line-and-graded/) |
| Valuation staleness at twelve months and after a priced round, strike prefill and below-FMV warning (`src/lib/captable.js`, `src/ui/securityform.js`) | [409A valuations](/guides/409a-valuations-explained/), [Record valuations](/docs/recording-valuations/) |
| Class over its authorized count, 83(b) window versus missed election, expired plan reserve (`src/lib/captable.js`, `src/ui/attention.js`) | [Attention items](/docs/resolving-attention-items/) |
| As-of issuance-date shortcuts, Getting started checklist, record label conventions (`src/views/captable.js`, `src/views/dashboard.js`, `src/lib/captable.js`) | [Historical cap table](/docs/reading-a-historical-cap-table/), [Dashboard](/docs/dashboard-and-search/), [Review securities](/docs/reviewing-securities/) |

## Additional worked concepts

| Concept checked | Guide |
| --- | --- |
| Outstanding-to-diluted reconciliation; avoiding double-counted certificates and reserves | [Reconcile a cap table](/guides/reconciling-a-cap-table/) |
| Forward and reverse split quantities, price units, proportional ownership, and fractional results | [Stock splits and ownership](/guides/stock-splits-and-ownership/) |
| Three independent transactions with different holders, denominators, and cash recipients | [Transfers, repurchases, and new issuances](/guides/transfers-repurchases-and-new-issuances/) |
| Granted, vested, exercised, certified, cancelled, and reserved quantities over one award's lifecycle | [Option grant lifecycle example](/guides/option-grant-lifecycle-example/) |
| Simple interest using days/365, discount versus cap pricing, maturity versus conversion | [Convertible note interest example](/guides/convertible-note-interest-example/) |
| Unallocated post-round pool target with a pre-money increase, investor ownership, and existing-holder dilution | [Option pool top-up dilution](/guides/option-pool-top-up-dilution/) |
| Gross share amount, exercise cost, preferred claims, and exclusions from modeled net proceeds | [Exit proceeds and exercise cost](/guides/exit-proceeds-and-exercise-cost/) |
| Context-specific definitions of ownership, awards, models, and recovery artifacts | [Cap table glossary](/guides/cap-table-glossary/) |
| Participation bases, entitlement, and the fixed versus additional round-size convention | [Pro rata rights explained](/guides/pro-rata-rights-explained/) |
| An MFN election as a dated snapshot of a later instrument's cap, discount, or money convention | [MFN clauses explained](/guides/mfn-clauses-explained/) |
| Cumulative versus non-cumulative dividends, simple and compound accrual, conversion and liquidation treatment | [Preferred dividends explained](/guides/preferred-dividends-explained/) |
| A 3x capped participating class at six sale values, and the effect of a cap that excludes the preference | [Participating preferred and caps](/guides/participating-preferred-and-caps/) |
| Payment order from note repayment to the residual, and the interaction between class elections | [Exit waterfall step by step](/guides/exit-waterfall-step-by-step/) |
| The sale values where debt is covered, the stack clears, and a class or SAFE converts | [Exit breakeven points](/guides/exit-breakeven-points/) |
| Rights that separate common from preferred stock, and authorization as a limit rather than a holding | [Common and preferred stock](/guides/common-and-preferred-stock/) |
| A 100,000-share ISO measured against the $100,000 limit year by year, with and without early exercise | [ISO $100,000 limit](/guides/iso-100k-limit/) |
| The two clocks that close a departing holder's options, and where the 90-day default comes from | [Post-termination exercise windows](/guides/post-termination-exercise-windows/) |
| What a 409A valuation measures, why a strike follows it, and the two refresh triggers | [409A valuations explained](/guides/409a-valuations-explained/) |
| Cumulative expense through four year ends under straight-line and graded attribution of the same award | [Expense attribution](/guides/expense-attribution-straight-line-and-graded/) |

## Editorial checks

- Checked against current application source on September 9, 2026.
- Regulatory sections label their US scope and link to IRS or SEC sources. Examples separate application defaults and model assumptions from legal or accounting determinations.
- Source checks include IRS Form 15620, IRS Topic 427, IRS instructions for Forms 3921/3922, SEC Rule 701 guidance and interpretations, and SEC SAB 107/110. Review the linked primary sources when rules, instructions, or app behavior change.
- Guide examples state their assumptions and use original worked calculations. No professional review or legal certification is claimed.
- Additional primary sources for this expansion: SEC Investor.gov stock-split and reverse-split explanations, SEC private secondary markets guidance, and Y Combinator's SAFE conversion explanation. Source links appear beside the supported statements in the articles. Product behavior is checked against the local implementation, not inferred from a general financial guide.
- The September 9 expansion corrects the former reference to a round-model scenario-date control, distinguishes the standard grant-date vesting schedule from the separate restricted-share start field, and explains the new-money ownership ratio in this model.
- Editorial tone: use factual descriptions, exact visible action names, explicit example assumptions, and concise explanations of actual limits. Avoid promotional claims, invented controls, and assurances that a software result establishes legal or accounting compliance.
- The public-content tests check paths, anchors, assets, metadata, sitemap coverage, navigation, and this inventory’s links. They do not independently prove editorial accuracy or a legal conclusion.
- Keep this table current when a user-facing feature changes. Confirm that each new article is discoverable from its hub and useful related reading.
- Analytics comes from `site/analytics.html`, injected into the homepage and rendered content heads. Launch links remain on the existing local app flow.

## Explicit boundaries

The documentation identifies unsupported warrant lifecycle events, contract-specific financing terms, automated tax filing and disclosure delivery, withholding/net-share arrangements, valuation services, and accounting arrangements outside the model. These boundaries are part of feature coverage, not missing instructions for actions the app cannot perform.
