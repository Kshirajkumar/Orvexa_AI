# Taxflow.AI

**AI-powered practice automation for Chartered Accountants and accounting firms.**

TaxFlow.AI is a Tauri desktop app backed by an Express API and Supabase. It supports client and document management, secure client-portal uploads, AI-assisted extraction with accountant review, Telegram messaging and reminders, compliance tracking, and document versioning. TaxFlow is not yet a certified tax-filing or government-submission system; see the [PRD](docs/PRD.md) for the longer-term product vision.

Client tax files, uploads, and generated documents are stored in the private Supabase Storage bucket (`taxflow-intake`). Supabase Database stores metadata and extracted results.

---

## Current application capabilities

For the detailed, dated baseline, see [Product Status](docs/product-status.md). “Built” means implemented in the repository; it does not automatically mean production-configured.

| Subsystem / Module | State | Current capability |
|---|:---:|---|
| **Desktop application** (Tauri v2, React 18, TypeScript) | Built | Client, files, extraction/review, deadlines, messaging, generation, onboarding, profile, settings, and subscription screens. |
| **Backend API** (Node.js, Express 5) | Built | Authenticated domain APIs for clients, documents, portal, extraction, review, deadlines, generation, messaging, notifications, and cleanup. |
| **Client portal and document storage** | Configuration required | Portal invitations and uploads use private Supabase Storage; apply the documented database migrations before enabling them. |
| **AI extraction and review** | Configuration required | Gemini runs through the backend. The optional Windows OpenRouter-key mode stores its key in Windows Credential Manager and sends extraction images directly from the desktop to OpenRouter. Extraction values are schema-checked and require human review. |
| **Invoice review** | Configuration required | GST invoice review detects duplicate originals/matches, records approved versions, and saves a versioned JSON export in the private `Extracted` folder. Requires the invoice-review SQL migrations. |
| **Telegram** | Configuration required | Text messaging, client linking, and scheduled reminders. Telegram is not a document-transfer channel; clients upload through the secure portal. |
| **WhatsApp** | Configuration required | Backend webhook, status, and outbound messaging integration; enablement depends on valid Meta credentials and webhook configuration. |

### Important product boundary

TaxFlow.AI currently manages tax-practice work and prepares/reviews supporting documents. It does not yet generate official GSTR/ITR filing artifacts, submit returns to government portals, provide a complete accounting ledger, or replace Tally/Zoho Books. Those are roadmap capabilities, not current claims.

---

## Architecture

```
+--------------------------------------------------------+
| Desktop Application (Tauri v2 + React + TypeScript)     |
+------------------------------+-------------------------+
                               | REST API
                               v
+--------------------------------------------------------+
| Express API (services/backend)                         |
| auth, clients, documents, extraction, schedules, etc.  |
+------------------------------+-------------------------+
                               |
               +---------------+----------------+
               v                                v
+---------------------------+       +---------------------------+
| Supabase Database         |       | Private Supabase Storage  |
| metadata, logs, extracted  |       | originals and outputs     |
| values                    |       | (taxflow-intake)           |
+---------------------------+       +---------------------------+
```

### Storage & Security Principles
1. **Never store raw PDFs or sensitive files directly in database rows**: Store originals and generated documents in the private Supabase Storage bucket; keep structured metadata and extraction results in Supabase Database.
2. **Account-scoped cloud objects**: Store objects under `{user_id}/{client_id}/{year}/{month}/{document_id}_{filename}` and validate ownership before every download or deletion. Extracted fields remain attached to the document metadata.
3. **Telegram is not document storage**: Telegram media from linked active clients is not downloaded or stored. The bot responds with a privacy notice and the client's portal invitation or sign-in link; documents must be uploaded through the secure client portal.
4. **Row Level Security (RLS)**: Database policies are defined to isolate account-owned practice data while allowing shared default templates. Apply the migrations and verify policies on the target Supabase project before deployment.

The optional local OpenRouter mode sends document images directly from the Windows desktop to OpenRouter. Use it only when that transfer is acceptable for the document and account; otherwise use the backend-configured provider.

---

## Database setup & migrations

To set up or refresh your Supabase database:

1. **Core Database Schema**: Run [`services/backend/db/schema.sql`](services/backend/db/schema.sql) in your Supabase SQL Editor to initialize users, clients, documents, and compliance deadlines.
2. **Full Inbox, Templates & Scheduling Setup**: Run [`services/backend/db/inbox_full_setup.sql`](services/backend/db/inbox_full_setup.sql). This is an all-in-one idempotent script that sets up:
   - Supported countries and client time zones (India, US, UAE, Singapore, UK)
   - Message templates table with all 9 default templates and RLS policies
   - Telegram message schedules table with one-time & daily cron constraints
   - Schedule worker stored procedures (`claim_due_telegram_message_schedules`, `finish_telegram_message_schedule`)
   - Auto-healing queries for clients missing country association.
3. **Document lifecycle**: Apply [`services/backend/db/document_lifecycle.sql`](services/backend/db/document_lifecycle.sql) and then [`services/backend/db/document_lifecycle_fk_indexes.sql`](services/backend/db/document_lifecycle_fk_indexes.sql) before using document versioning and durable storage cleanup.
4. **Invoice review and export**: Apply [`services/backend/db/invoice_review_workflow.sql`](services/backend/db/invoice_review_workflow.sql), then [`services/backend/db/invoice_review_source_idx.sql`](services/backend/db/invoice_review_source_idx.sql). These add duplicate-aware invoice review, review/version history, and the database functions used to save approved JSON exports. They require the core schema and document lifecycle migrations. If the workflow script was previously installed, reapply it to update the export-version category check.
5. **Telegram and client portal**: From `services/backend`, run `npm run migrate:telegram` with `DATABASE_URL` set for the same project. Follow the [Telegram integration guide](docs/telegram-integration.md) for portal, bucket, and relay setup.

---

### Existing local-document migration

Before deploying the cloud-only document routes, apply `services/backend/db/migrate_cloud_document_storage.sql` to the same Supabase project. Configure `SUPABASE_STORAGE_BUCKET=taxflow-intake`, and run `npm run migrate:storage` from `services/backend` with valid `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `VAULT_PATH`. The migration script uploads metadata-linked local files, verifies each cloud copy by SHA-256, and records the private object path. It does not delete local source files. Review each result and verify all files before removing any legacy copies. Files outside the configured legacy vault or larger than the bucket's 20 MiB limit are reported and left untouched.

## Getting started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Rust & Cargo**: stable toolchain via [rustup.rs](https://rustup.rs)
- **Windows**: Microsoft C++ Build Tools & WebView2

### 1. Configure the backend

```bash
cd services/backend
npm install
```

Create `services/backend/.env` from `.env.example` (for example, in PowerShell run `Copy-Item .env.example .env`).

Edit `services/backend/.env` with your credentials:

```ini
PORT=5000
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=your-supabase-secret-key
SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_STORAGE_BUCKET=taxflow-intake
CLIENT_PORTAL_URL=https://orvvexa.vercel.app
GEMINI_API_KEY=your-google-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_BOT_USERNAME=@YourPracticeBot
TELEGRAM_WEBHOOK_SECRET=your-secure-webhook-secret
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_ACCESS_TOKEN=your-whatsapp-access-token
WHATSAPP_VERIFY_TOKEN=your-long-random-webhook-verification-token
WHATSAPP_APP_SECRET=your-meta-app-secret
```

### 2. Run development

You can run both backend and desktop UI concurrently using the built-in runner:

```bash
cd apps/desktop
npm run dev:full
```

Or run them individually:
```bash
# Terminal 1: Backend API
cd services/backend
npm run dev

# Terminal 2: Desktop Tauri Shell
cd apps/desktop
npm run tauri dev
```

### 3. Build a Windows installer (.msi / .exe)

```bash
cd apps/desktop
npm run tauri build
```
The compiled release installer will be generated in `apps/desktop/src-tauri/target/release/bundle/msi/`.

---

## API overview

Base URL: `http://localhost:5000/api/v1`

| Endpoint | Methods | Description |
|---|---|---|
| `/health` | `GET` | Backend and integration status |
| `/auth/*`, `/client-portal/*` | Multiple | Staff authentication and client portal workflows |
| `/clients/*`, `/documents/*` | Multiple | Client and private document management, downloads, versions, and review status |
| `/extraction/process` | `POST` | Run configured backend AI extraction on a stored document |
| `/extraction/save` | `POST` | Validate and save extraction results created with the local OpenRouter-key mode |
| `/extraction/review` | `POST` | Save reviewed GST invoice data, detect duplicates, and complete the versioned export workflow |
| `/extraction/pending`, `/extraction/ai-usage` | `GET` | Review queue and AI usage |
| `/deadlines/*`, `/generate/*` | Multiple | Compliance deadlines and generated outputs |
| `/schedules/*`, `/templates/*`, `/telegram/*`, `/whatsapp/*` | Multiple | Messaging, templates, scheduled reminders, and webhooks |
| `/storage-cleanup/*`, `/notifications/*`, `/metadata/*`, `/chat/*` | Multiple | Cleanup operations, notifications, metadata, and assistant APIs |

This is a feature overview, not a complete request/response contract. Route behavior and permissions are implemented in `services/backend/routes/`.

---

## 🗺️ Roadmap & Future Phases

The detailed status classification is maintained in [docs/product-status.md](docs/product-status.md). The items below are roadmap work, not shipped functionality:

- [x] Full database-driven message templates with dynamic `{name}` and `{portalLink}` placeholders
- [x] Row Level Security (RLS) separating system defaults from CA private templates
- [x] Mid-sized floating modal dialog for template creation and editing
- [x] Server-side Telegram scheduled reminders with multi-country timezone support
- [x] Auto-healing country and timezone assignment for practice clients
- [ ] Automated end-to-end integration test suite (the backend currently has Node.js unit tests; `npm test` runs them)
- [ ] Multi-staff role permissions (Partner, Senior Associate, Article Trainee)
- [x] Reviewed GST invoice records with private, versioned JSON exports (requires the invoice-review migrations)
- [ ] Official-schema GSTR-1, GSTR-3B, and ITR filing outputs and government submission after explicit human approval
- [ ] Agent-run orchestration with visible plans, live action stream, and review gates across complete filing tasks
- [ ] Books, inventory, bank reconciliation, e-invoicing/e-way bills, payroll, reporting, and multi-staff permissions
- [ ] Mobile/web review clients, public API/marketplace, and accounting-system migration parity

---

**Taxflow.AI**: Automating the administrative friction so Chartered Accountants can focus on advisory.
