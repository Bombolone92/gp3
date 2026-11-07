# Puter platform requirements for enterprise identity

Whiteboard uses Puter.js as its only backend. Most enterprise controls are implemented inside the organization's Puter worker and are available today. A few identity controls belong to the Puter account platform, because they concern how a person signs in to Puter rather than what they can do in Whiteboard. This document lists what the platform must provide and how Whiteboard uses it.

## Available in Whiteboard today

| Capability                          | How it works                                                                                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization with unlimited members | Every organization is one Puter worker owned by the account owner; membership is not limited by seats.                                                                                                                                                     |
| Domain verification and capture     | Members verify a work email with a one-time code sent by the organization's worker. With domain capture on, verified addresses in the organization's domains join automatically.                                                                           |
| Provisioning and deprovisioning     | SCIM 2.0 (`/scim/v2/Users`, `/scim/v2/Groups`) and a documented REST API authenticated with scoped API keys. Provisioned people are pending until they sign in and verify the same email; deactivation ends their access and live sessions on every board. |
| Roles                               | Organization roles (owner, administrator, member, guest) and board roles (owner, facilitator, editor, commenter, viewer, plus guest memberships with expiry), enforced by the worker.                                                                      |
| Audit and SIEM                      | Audit log with export to Microsoft Sentinel (Logs Ingestion API) or any HTTPS endpoint, pull API, webhooks, and alerts.                                                                                                                                    |
| AI administration                   | The organization's worker runs every AI request for members, so turning features off is enforced server-side.                                                                                                                                              |

## Required from the Puter account platform

### 1. SAML 2.0 single sign-on with Google Workspace

- Puter accounts must support signing in through a customer's SAML identity provider (Google Workspace as a custom SAML app), with IdP-initiated and SP-initiated flows.
- The platform must bind an organization's verified domains to its IdP, so people with those addresses are redirected to Google Workspace instead of entering a Puter password.
- Tokens issued after SAML sign-in should carry the verified email and an `idp` claim, so the organization's worker can trust the email without its own verification code.

How Whiteboard uses it: the verification-code flow remains as a fallback; when the claim is present, the worker links the account to its SCIM record and applies domain capture immediately.

### 2. Enforced multifactor authentication

- Puter must let an account (or a domain bound to an IdP) require multifactor authentication.
- Access tokens must expose the authentication strength, for example an `amr` or `mfa` claim that the worker can read from the restricted collaboration credential.

How Whiteboard uses it: the organization policy includes `mfaRequired`, shown in Organization settings under Security as "Require multifactor authentication". The worker refuses to turn it on until tokens carry the claim, then enforces it on every request. Until then, SSO through Google Workspace (which can enforce MFA at the IdP) is the recommended path.

### 3. Account provisioning by the identity provider

- Today SCIM creates pending organization records; the person creates or uses a Puter account and verifies their email to activate them.
- The platform should allow an organization owner to provision Puter accounts directly for their verified domains (the Teams feature provides seats but is capped at 40 per paid owner), so SCIM can create a ready-to-use account and deprovisioning can disable it at the platform level.

### 4. Domain ownership verification

- The platform should verify domain ownership (for example a DNS TXT record) before an organization can capture a domain, so domain capture is backed by proof of ownership rather than by email verification alone.

### 5. Service commitments

- Published availability targets and status reporting for the Puter API, workers, KV, file storage, and peer relays, which Whiteboard depends on for shared boards.

## Summary

| Capability                     | Status                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| SAML SSO with Google Workspace | Requires item 1                                                          |
| Domain verification or capture | Available (email verification and domain capture); item 4 strengthens it |
| Enforce MFA                    | Requires item 2 (or MFA enforced by Google Workspace through item 1)     |
| SCIM or documented APIs        | Available                                                                |
| Audit logs to Azure Sentinel   | Available                                                                |
