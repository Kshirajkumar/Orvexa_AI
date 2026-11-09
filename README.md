# Taxflow.AI

**AI-powered practice automation for Chartered Accountants and accounting firms.**

Taxflow.AI is an enterprise desktop application that eliminates repetitive administrative work from a CA practice: collecting client documents over secure channels (Telegram & WhatsApp), extracting invoice/bill data with AI, tracking multi-country compliance deadlines, managing private cloud documents, and generating filing-ready outputs.

Client tax files, uploads, and generated documents are stored in the private Supabase Storage bucket (`taxflow-intake`). Supabase Database stores metadata and extracted results.

---

## 🚀 Build & Production Readiness Status

| Subsystem / Module | Readiness Status | Capabilities & Production Details |
|---|:---:|---|
| **Desktop Application** (Tauri v2 + React 18 + TS) | **✅ Production-Grade** | Native Windows desktop app, custom frameless titlebar, real-time reactive state, zero-flicker UI, light/dark themes, offline capability. |
| **Backend API Service** (Node.js + Express 5) | **✅ Production-Grade** | Modular domain routing, robust JWT session auth (`requireAuth`), comprehensive input validation, dual-endpoint trailing-slash normalization, demo-mode fallback. |
| **Database & Row Level Security (RLS)** | **✅ Production-Grade** | Strict Supabase PostgreSQL schema, RLS policies separating shared assets (`user_id IS NULL`) from private CA assets (`user_id = auth.uid()`), indexed foreign keys. |
| **Client Intake & Secure Portal** | **✅ Production-Grade** | Private tokenized portal invitations, cryptographic token hashing (`sha256`), AES authenticated encryption for token reuse, direct-to-cloud upload to private bucket. |
| **Cloud Document Storage** | **Production-Grade** | Private Supabase Storage bucket, account-scoped object paths, upload validation, checksum metadata, and cloud-backed document browsing. |
| **Message Templates Management** | **✅ Production-Grade** | 100% database-driven with zero hardcoded fallbacks, shared defaults + private CA templates, dynamic `{name}`, `{portalLink}` placeholders, live preview, mid-sized modal editor. |
| **Telegram Messaging & Scheduling** | **✅ Production-Grade** | Webhook relay integration, deduplicated update processing, server-side scheduled reminders (one-time & daily), country time zone conversion, 15-second worker loop. |
| **AI Document Extraction (Gemini / OpenRouter)** | **Operational** | Original files are read from private cloud storage; structured extracted values are saved in Supabase metadata and require human review. |
| **Multi-Country Compliance & Timezones** | **⚡ Operational** | Built-in support for India (IN - Asia/Kolkata), United States (US - America/New_York, Chicago, Denver, Phoenix, LA, Anchorage, Honolulu), UAE (AE - Asia/Dubai), Singapore (SG - Asia/Singapore), United Kingdom (GB - Europe/London). |
| **WhatsApp Cloud API** | **🔧 Config-Ready** | Official Meta WhatsApp Cloud API integration with webhook verification and manual messaging (requires Meta app credentials in `.env`). |

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
3. **No Telegram document leaks**: Sensitive tax documents are never accepted over unencrypted chat; Telegram updates automatically reply with a privacy warning and a single-use private client portal invitation link.
4. **Row Level Security (RLS)**: Enforces that practice data is strictly isolated to the authenticated CA account while default compliance templates remain accessible practice-wide.

---

## 🗄️ Database Setup & Migrations

To set up or refresh your Supabase database:

1. **Core Database Schema**: Run [`services/backend/db/schema.sql`](services/backend/db/schema.sql) in your Supabase SQL Editor to initialize users, clients, documents, and compliance deadlines.
2. **Full Inbox, Templates & Scheduling Setup**: Run [`services/backend/db/inbox_full_setup.sql`](services/backend/db/inbox_full_setup.sql). This is an all-in-one idempotent script that sets up:
   - Supported countries and client time zones (India, US, UAE, Singapore, UK)
   - Message templates table with all 9 default templates and RLS policies
   - Telegram message schedules table with one-time & daily cron constraints
   - Schedule worker stored procedures (`claim_due_telegram_message_schedules`, `finish_telegram_message_schedule`)
   - Auto-healing queries for clients missing country association.

---

### Existing local-document migration

Before deploying the cloud-only document routes, apply `services/backend/db/migrate_cloud_document_storage.sql` to the same Supabase project. Configure `SUPABASE_STORAGE_BUCKET=taxflow-intake`, and run `npm run migrate:storage` from `services/backend` with valid `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `VAULT_PATH`. The migration script uploads metadata-linked local files, verifies each cloud copy by SHA-256, and records the private object path. It does not delete local source files. Review each result and verify all files before removing any legacy copies. Files outside the configured legacy vault or larger than the bucket's 20 MiB limit are reported and left untouched.

## 💻 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Rust & Cargo**: stable toolchain via [rustup.rs](https://rustup.rs)
- **Windows**: Microsoft C++ Build Tools & WebView2

### 1. Configure the Backend

```bash
cd services/backend
npm install
copy .env.example .env
```

Edit `services/backend/.env` with your credentials:

```ini
PORT=5000
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_STORAGE_BUCKET=taxflow-intake
CLIENT_PORTAL_URL=https://taxflowaiwebsite.vercel.app/portal
GEMINI_API_KEY=your-google-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_BOT_USERNAME=@YourPracticeBot
TELEGRAM_WEBHOOK_SECRET=your-secure-webhook-secret
```

### 2. Run the Development Server

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

### 3. Build a Production Windows Installer (.msi / .exe)

```bash
cd apps/desktop
npm run tauri build
```
The compiled release installer will be generated in `apps/desktop/src-tauri/target/release/bundle/msi/`.

---

## 📋 Comprehensive API Reference

Base URL: `http://localhost:5000/api/v1`

| Endpoint | Method | Description |
|---|---|---|
| `/health` | `GET` | Health check & connection status for DB, cloud document storage, AI, and WhatsApp |
| `/auth/login` | `POST` | Authenticate CA firm user and return JWT session |
| `/auth/register` | `POST` | Register a new CA firm account |
| `/clients` | `GET, POST` | List practice clients and add a new client |
| `/clients/:id` | `GET, PATCH, DELETE` | Retrieve client details, update metadata, archive client |
| `/templates` | `GET, POST` | List database templates (defaults + private) and create private templates |
| `/templates/:id` | `PATCH, DELETE` | Modify or delete user-owned private template |
| `/schedules` | `GET, POST` | List and create scheduled Telegram reminders (one-time or daily) |
| `/schedules/:id` | `DELETE` | Cancel an active scheduled reminder |
| `/schedules/:id/retry` | `POST` | Retry a failed reminder |
| `/schedules/timezones` | `GET` | Retrieve supported countries and country time zones |
| `/documents` | `GET, POST` | Upload to private cloud storage and inspect document metadata |
| `/extraction` | `POST` | Run Google Gemini AI extraction on uploaded documents |
| `/deadlines` | `GET, POST` | Track compliance tasks, upcoming statutory deadlines, and filing progress |

---

## 🗺️ Roadmap & Future Phases

- [x] Full database-driven message templates with dynamic `{name}` and `{portalLink}` placeholders
- [x] Row Level Security (RLS) separating system defaults from CA private templates
- [x] Mid-sized floating modal dialog for template creation and editing
- [x] Server-side Telegram scheduled reminders with multi-country timezone support
- [x] Auto-healing country and timezone assignment for practice clients
- [ ] Automated end-to-end integration test suite (`npm test`)
- [ ] Multi-staff role permissions (Partner, Senior Associate, Article Trainee)
- [ ] Exportable GSTR-1, GSTR-3B, and ITR computation JSON/Excel outputs

---

**Taxflow.AI**: Automating the administrative friction so Chartered Accountants can focus on advisory.
