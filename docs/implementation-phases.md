# Implementation status

**Reviewed:** 22 November 2026
For the complete product inventory and status definitions, see [Product Status](product-status.md).

This replaces the earlier two-phase checklist, which assumed Telegram document intake. The current product deliberately does not transfer documents through Telegram; clients upload through the secure portal. The requirements and longer-term product vision remain in [PRD.md](PRD.md).

## Implemented in the repository

These features are present in code and require the appropriate backend configuration and database migrations:

- Authenticated desktop/API workflows and a client portal with invitation-based enrollment and private cloud uploads.
- Private Supabase document storage, metadata checksums, version history, and queued storage cleanup.
- Telegram client linking, text messaging, templates, and scheduled reminders; Telegram media is not downloaded or stored.
- AI extraction with category-specific field/type validation and a human review screen.
- GST invoice duplicate detection, explicit update of an existing invoice, recorded review versions, and a private versioned JSON export.
- Backend unit tests using Node's built-in test runner (`npm test`).
- Notice-response and computation-sheet generation helpers, generated-document persistence, notifications, profile/settings, and account-deletion workflows.

The invoice review workflow requires the core schema and document lifecycle migrations, followed by `db/invoice_review_workflow.sql` and `db/invoice_review_source_idx.sql`. See [BACKEND_GUIDE.md](../BACKEND_GUIDE.md) for storage, permissions, and migration details.

## Still release gates

- Apply the required SQL to the target Supabase project and verify account isolation/RLS against that live project. Repository contents alone do not prove a live deployment is configured correctly.
- Add and run end-to-end integration tests for portal upload, extraction, invoice review, export, storage cleanup, and messaging.
## Roadmap work

- Build and validate official filing schemas/exports for forms such as GSTR and ITR. The current invoice JSON export is not a filing-ready return.
- Implement broader agent-run orchestration, maker-checker permissions, and any government submission only through an authorised channel and after explicit human approval.
- Implement books, inventory, bank reconciliation, e-invoicing/e-way bills, payroll, reporting, mobile/web access, public integrations, and accounting-system parity tooling.

Do not treat this status page as a production certification report. Consult the [Product Status](product-status.md) page for the dated baseline, the [README](../README.md) for development setup, and the [PRD](PRD.md) for planned requirements.
