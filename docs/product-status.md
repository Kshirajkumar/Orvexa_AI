# TaxFlow.AI Product Status

**Status date:** 22 November 2026
**Evidence source:** current repository implementation, route modules, desktop pages, database migrations, and backend tests.
**Purpose:** canonical description of what TaxFlow.AI does today, what is usable after configuration, and what is still being developed.

This document describes the product that exists in this repository. It is not a production certification report and it does not prove that a particular Supabase project, deployment, provider account, webhook, or migration set is configured correctly.

## Product in one sentence

TaxFlow.AI is a Tauri desktop practice-management application for tax professionals that combines client records, private document storage, AI-assisted document extraction, mandatory human review, compliance task tracking, document generation, client-portal uploads, and messaging integrations.

TaxFlow.AI does **not** currently certify tax returns, replace a government filing portal, or submit tax filings to a government authority.

## Status legend

- **Built:** implemented in the repository and exposed through the desktop app or backend API.
- **Configuration required:** implemented, but depends on Supabase migrations, private storage, provider credentials, deployment settings, or another external service.
- **Release gate:** code exists or the workflow is partially present, but live-project verification, broader testing, or operational work is still required before calling it production-ready.
- **Roadmap:** described in the product vision or future requirements, but not implemented as a complete product capability.

## Built now

### Practice workspace

- Authenticated practice account signup, email OTP verification, login, refresh, password reset, profile updates, onboarding completion, and account deletion flow.
- Desktop navigation for Dashboard, Invoice Extraction, Data Extraction Review, Client Inbox, Client Folders, Deadlines, File Generator, Clients, Subscriptions, Profile, and Settings.
- Client records with create, read, update, delete, ownership checks, tax/profile fields, and client workspace navigation.
- Compliance/deadline tasks with listing, creation, updates, summary data, status, progress, and due-date validation.

### Documents and storage

- Private Supabase Storage for original, extracted, and generated documents.
- Client/document ownership validation, metadata, checksums, MIME/type and size validation, version history, replacement uploads, downloads, and metadata edits.
- Queued two-phase cleanup for document and client deletion, with retry/status endpoints and a backend cleanup worker.
- Client portal invitation, enrollment, sign-in, access management, and private uploads into the same cloud document workflow.

### AI-assisted extraction and review

- Extraction categories: GST invoice, Form 16, income-tax document, bank statement, tax notice, and general document.
- Backend Gemini extraction for stored documents.
- Optional local OpenRouter-key extraction from the Windows desktop; the key is kept in Windows Credential Manager and document images are sent directly to OpenRouter.
- Strict category-specific field/type validation before extraction data is saved.
- Extraction queue, pending review, source document access, correction, approval/rejection, and review history.
- AI usage logging for backend extraction requests.

### GST invoice workflow

- Human-reviewed GST invoice data.
- Duplicate detection by source/invoice identity and explicit update choice for an existing invoice.
- Versioned review records and a checksum-verified JSON snapshot in the private `Extracted` folder after approval.

The GST JSON snapshot is an approved invoice record. It is **not** a GSTR-1, GSTR-3B, ITR, or other government filing artifact.

### Messaging, intake, and generated outputs

- Telegram client linking, text conversations, inbox/search/unread/read state, message templates, and scheduled reminders with timezone-aware scheduling.
- Telegram privacy boundary: media is not downloaded, stored, extracted, or served. Clients are directed to the secure portal for documents.
- WhatsApp webhook/status/message workflows, including signature verification and authenticated outbound messages, subject to Meta configuration.
- Email notification support through Resend, subject to provider configuration.
- Notice-response draft generation, computation-sheet generation, and private generated-document storage.

## Available after configuration

The following features are implemented but are not enabled by code alone:

1. Supabase database, RLS, private `taxflow-intake` bucket, and the required migrations.
2. Backend authentication and server configuration, including Supabase keys and the deployment API URL.
3. Gemini extraction through `GEMINI_API_KEY`.
4. OpenRouter local extraction through the device credential setup.
5. Telegram bot, relay, webhook secret, and client-portal URL.
6. WhatsApp Business credentials, webhook verification, and Meta signature configuration.
7. Resend credentials and sender configuration for email notifications.
8. Invoice-review, document-lifecycle, portal, Telegram, notification, and storage migrations applied to the same live Supabase project.

If a dependency is missing, cloud-backed mutations should fail clearly. Seeded UI values or read-only demo responses must not be interpreted as synchronized live practice data.

## Current limitations and release gates

- The repository does not prove that the target deployment has the complete migration set, correct RLS, a private bucket, working provider credentials, or operational webhook delivery.
- Backend unit tests exist, but end-to-end coverage is still needed for portal upload, extraction, invoice approval/export, cleanup retries, scheduling, and messaging.
- The desktop has a production build command, but a build passing is not evidence that a deployed environment or external integration works.
- The UI contains seed data for initial/offline presentation and may retain last-known client data locally. Live records must be verified through authenticated API responses.
- There is no multi-staff role/permission matrix or maker-checker separation for practice users.
- Generated notice responses and computation sheets are drafts/helpers; professional review remains required.

## Under development / roadmap

These are not complete product capabilities in the current repository:

- Official-schema filing files for GSTR forms, ITRs, and other country-specific returns.
- Government submission through an authorised channel, always after explicit human approval.
- A general agent-run orchestrator with visible plans, live action streaming, and review gates across a complete filing task.
- Double-entry books, ledgers, trial balance, profit and loss, balance sheet, inventory, bank feeds/reconciliation, e-invoicing/e-way bills, payroll, and broader reporting.
- Multi-staff roles, custom permissions, approval limits, maker-checker controls, and two-factor policy enforcement.
- Mobile and browser review experiences beyond the current desktop application.
- Public API, marketplace integrations, accounting-system migration/parity tooling, and full end-to-end production-readiness suites.

## Explicit non-claims

TaxFlow.AI should not currently be described as an automated tax-filing agent, a certified GSTR/ITR preparation or submission system, a replacement for Tally or Zoho Books, or a Telegram document-transfer service.

## Verification commands

```powershell
cd services/backend
npm test

cd ../../apps/desktop
npm run build
```

These commands verify repository-level tests and compilation/build output only. They do not validate external services or live deployment configuration.

## Related documents

- [README](../README.md) — setup, architecture, API overview, and short roadmap.
- [PRD](PRD.md) — long-term product vision and requirements; it is not a current-capability inventory.
- [Implementation phases](implementation-phases.md) — implementation evidence and remaining release gates.
- [Telegram integration](telegram-integration.md) — messaging and portal boundary.
- [Backend guide](../BACKEND_GUIDE.md) — storage, API, security, and migration rules.
