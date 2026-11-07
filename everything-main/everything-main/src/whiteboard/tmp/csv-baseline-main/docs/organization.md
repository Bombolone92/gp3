# Organizations

An organization gives a team centralized administration: members and teams, sharing and AI policy, a board directory, audit logs, reports, integrations, and APIs. Every rule is enforced by the organization's Puter worker, not only by the interface.

## Model

- **One worker per organization.** The account that sets up the organization deploys (or reuses) its collaboration worker and becomes the **account owner**: the primary administrator responsible for configuration, integrations, and the Puter plan that stores organization boards, audit logs, and files.
- **Unlimited members.** Membership is a record in the worker, not a seat. Members create shared boards on the organization's worker, where its policies apply.
- **Organization roles:** owner (one, the account owner), administrator, member, and guest. Only the owner appoints administrators; administrator API keys can never grant administration.
- **Board roles:** owner, facilitator, editor, commenter, and viewer. Guests from outside the organization hold one of these roles on specific boards, are marked as guests, and can have expiring access.

| Board role  | Content | Comments, reactions, votes | Manage participants          | Settings and governance               |
| ----------- | ------- | -------------------------- | ---------------------------- | ------------------------------------- |
| Owner       | Yes     | Yes                        | Yes, including facilitators  | Visibility, transfer, archive, delete |
| Facilitator | Yes     | Yes                        | Editors, commenters, viewers | Visibility and defaults               |
| Editor      | Yes     | Yes                        | No                           | No                                    |
| Commenter   | No      | Yes                        | No                           | No                                    |
| Viewer      | No      | No                         | No                           | No                                    |

Organization administrators can open and govern every board on the worker without being a participant.

## Joining

- **Invitation links** (member, guest, or administrator) from Organization settings → People. They expire after 14 days by default and can be revoked. An administrator link works for one person.
- **Domain capture.** Add email domains in Policies and turn on domain capture. A person signs in with Puter, chooses **Verify your email**, and enters the six-digit code the worker emails them. Verified addresses in the organization's domains join as members automatically.
- **SCIM provisioning.** People provisioned by an identity provider are pending until they sign in and verify the same email, then inherit the provisioned role, teams, and status. Board access granted to a pending address (for example during a migration) moves to their account at that moment.
- **Site configuration.** A deployment can include `/organization.json` with `{ "server": "https://<worker>.puter.work" }`, so every visitor sees the organization without a link.

## Organization library

Members share templates from a board with **Share to organization library** in the command palette, and Miro migrations can save boards there as templates. Open **Organization library** from the library sidebar or the command palette to search it and start a new board from a template. A member's submission appears for everyone once an administrator approves it; administrators' submissions appear right away. The person who shared an item, and administrators, can remove it. Shared copies leave out comments and content hidden from the person sharing.

## Policies

| Policy                                  | Effect                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Email domains, domain capture           | Which verified addresses join automatically                                                                        |
| Members can create boards               | Whether members (not only administrators) create boards on the worker                                              |
| Default board visibility                | Invited people only, or everyone in the organization                                                               |
| Sharing outside the organization        | Not allowed, invited guests only, or guests and public links                                                       |
| Guest access and expiry                 | Whether guests can join, and for how many days                                                                     |
| Public links                            | Whether a board can be opened by anyone signed in with its link                                                    |
| Restrict boards to organization members | Rejects every non-member, even with an invitation                                                                  |
| AI features                             | On or off overall, and separately for summaries, themes, and handwriting; optional model                           |
| Integrations                            | Google Workspace, Slack, Jira, embedded content, webhooks, Miro imports                                            |
| Retention and legal hold                | Audit log retention (30 to 3,650 days), recoverable period for deleted boards, and an organization-wide legal hold |
| Scheduled reports                       | Weekly or monthly email of the administrative report                                                               |
| Alerts                                  | Email and Slack alerts for public sharing, guest access, permission changes, and policy changes                    |

Administrators can also place a legal hold on a single board from the Boards tab, which blocks deletion regardless of retention.

## Boards directory and search

Members see boards shared with them, or every board open to the organization, with search across board names and content and filters for space, team, activity, content type, date, and archive state. Administrators see every board with ownership, sharing, size, guests, and session peaks, can find duplicates (same content or same name) and stale or empty boards, export the directory as CSV, and archive, restore, delete, transfer, or hold boards.

## Audit log

Every administrative, security, access, sharing, API, and board content event is recorded with time, actor, target, board, source address, and details. Examples: `org.created`, `policy.updated`, `user.joined`, `user.role.changed`, `user.deactivated`, `apikey.created`, `board.created`, `board.visibility.link`, `board.guest.joined`, `board.role.changed`, `board.invite.created`, `board.transfer`, `board.archived`, `board.deleted`, `board.hold.placed`, `board.export`, `board.content.updated`, `board.content.restored`, `board.comment.created`, `board.migrated`, `ai.used`, `api.read`, `scim.user.updated`. An edit that adds more than 20 comment messages at once, as when threads are pasted, records the first 20 as one `board.comment.created` each and the rest as a single `board.comment.created` whose details give their `count`.

The Audit log tab filters by date, category, and action, and exports CSV or JSON. Each board also has an activity log. Records older than the retention period are removed in small batches unless a legal hold is on.

## Reports

The Overview tab reports active, inactive, deactivated, pending, and guest users; daily active users and the largest simultaneous session per day; boards created per week, active, stale, and empty boards; top owners and largest boards; external sharing (organization-visible boards, public links, boards with guests); and the largest sessions. Reports export as JSON and CSV, are available through the REST API, and can be emailed on a schedule.

## APIs

Create API keys in Organization settings → Security. Keys are shown once, can expire, and carry scopes: `scim`, `users:read`, `users:write`, `boards:read`, `boards:write`, `audit:read`, `reports:read`, `webhooks:write`. Send them as bearer tokens. The worker publishes an OpenAPI 3.1 description at `/v1/openapi.json`.

| Endpoint                                                             | Scope                        | Purpose                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /v1/audit`                                                      | `audit:read`                 | Audit events, newest first, filterable; `format=ndjson` for SIEM ingestion, paging with `cursor`               |
| `GET /v1/users`, `GET /v1/users/{uuid}`                              | `users:read`                 | Users; `format=csv`                                                                                            |
| `PATCH /v1/users/{uuid}`                                             | `users:write`                | Role (member or guest) and status (active or deactivated)                                                      |
| `GET/POST /v1/teams`, `PATCH/DELETE /v1/teams/{id}`                  | `users:read` / `users:write` | Teams and membership                                                                                           |
| `GET /v1/boards`                                                     | `boards:read`                | Directory with the same filters as the interface, in pages of up to 1,000 (`limit`, `offset`) with the `total` |
| `GET /v1/boards/duplicates`                                          | `boards:read`                | Possible duplicates                                                                                            |
| `GET /v1/boards/{room}`                                              | `boards:read`                | Board metadata and members                                                                                     |
| `PATCH /v1/boards/{room}`                                            | `boards:write`               | Transfer ownership, archive, restore, delete, legal hold, visibility                                           |
| `GET /v1/boards/{room}/activity`                                     | `audit:read`                 | Board activity log                                                                                             |
| `GET /v1/reports`, `/v1/reports/users.csv`, `/v1/reports/boards.csv` | `reports:read`               | Reports                                                                                                        |
| `GET/POST /v1/webhooks`, `DELETE /v1/webhooks/{id}`                  | `webhooks:write`             | Webhook subscriptions; creating one also needs `audit:read`, since deliveries carry audit events               |
| `/scim/v2/Users`, `/scim/v2/Groups`                                  | `scim`                       | SCIM 2.0 provisioning, including `ServiceProviderConfig`, `ResourceTypes`, and `Schemas`                       |

SCIM users are matched by `userName` (the work email). The extension `urn:ietf:params:scim:schemas:extension:whiteboard:2.0:User` carries `role` (`member` or `guest`) and read-only `license`, `puterUsername`, and `linked`. `PATCH` supports `active`, names, `externalId`, and roles; `DELETE` deactivates a linked user or removes a pending one. As in the admin console, only a SCIM key the account owner created can deactivate, reactivate, or delete an administrator. Groups map to teams, including add and remove member operations.

## Webhooks

Webhooks receive JSON `{ id, event, created, data }` for subscribed event prefixes (for example `board`, `user`, `board.guest`), with `X-Whiteboard-Event`, `X-Whiteboard-Delivery`, and `X-Whiteboard-Signature: sha256=<HMAC of the body with the webhook secret>`. Failed deliveries retry with exponential backoff up to six attempts.

## Integrations

- **Google Workspace:** embeds of Docs, Sheets, Slides, Forms, and Drive items, and importing Google Sheets as tables. Single sign-on depends on the Puter platform; see [Puter platform requirements](puter-platform-requirements.md). SCIM provisioning works with Google Workspace automation.
- **Slack:** organization alerts to a channel, and per-board channels for mentions.
- **Jira Cloud:** send task objects to a project as issues and show their status on the board.
- **Microsoft Sentinel:** see [Sentinel integration](sentinel/README.md).
- **Miro:** migrate boards with owners, member roles, and a validation report; see the README.

## Platform limits

Organization records use the account owner's Puter KV and storage, subject to [Puter's rate limits and quotas](https://docs.puter.com/rate-limits-and-quotas/). Transactional email (verification codes, notifications, alerts, reports) requires the account owner to be on a paid Puter plan.
