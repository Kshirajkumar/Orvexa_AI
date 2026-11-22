# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TaxFlow.AI is a Tauri desktop application with a React/TypeScript frontend and an Express/Supabase backend. The product currently supports practice management, private document storage, client-portal uploads, human-reviewed extraction, GST invoice review/export, compliance tracking, document generation helpers, and messaging. It does not yet provide official filing artifacts, certified tax filing, government submission, complete accounting books, or multi-staff permissions. Keep [docs/product-status.md](docs/product-status.md) as the dated current-capability baseline.

## Development Commands

### Desktop (React + TypeScript + Vite + Tauri)
Run from `apps/desktop`:
- `npm install` — Install dependencies
- `npm run dev` — Start Vite dev server
- `npm run dev:full` — Start Vite UI and backend together (via `scripts/dev-full.mjs`)
- `npm run build` — Type-check (`tsc -b`) then Vite production build
- `npm run preview` — Preview Vite build
- `npm run tauri` — Tauri CLI (use `tauri dev` for dev, `tauri build` for production)

### Backend (Node.js + Express + Supabase)
Run from `services/backend`:
- `npm install` — Install dependencies
- `npm run dev` — Start with file watcher (`node --watch index.js`)
- `npm start` — Start production (`node index.js`)
- `npm test` — Run tests (`node --test test/*.test.js`)

#### Backend Migrations
- `npm run migrate:storage` — Migrate local vault documents to cloud (`db/migrate_local_vault_documents.js`)
- `npm run migrate:telegram` — Apply Telegram and portal migrations (`db/apply_telegram_migration.js`)
- `npm run migrate:notifications` — Apply notifications migration (`db/apply_notifications_migration.js`)

## Architecture & Structure

TaxFlow.AI is a full-stack practice suite for tax professionals, consisting of a React frontend and a Node.js backend.

### High-Level Architecture
- **Frontend**: Pages live in `apps/desktop/src/pages/`; shared state uses React Context and `useReducer` in `src/state/store.tsx`. Styles are in `src/styles.css`. `src/lib/api.ts` calls the backend; `src/lib/openRouter.ts` implements the optional local OpenRouter extraction mode.
- **Backend**: `services/backend/index.js` mounts Express routes under `/api/v1/`. Supabase Postgres stores metadata, extraction results, invoice review history, and messaging state. Document bytes use private Supabase Storage through `lib/documentStorage.js`.
- **AI**: Backend extraction uses the configured Gemini provider; local OpenRouter-key extraction results are validated and saved through the backend. Extracted data is reviewed before approval.
- **Intake and messaging**: Client documents are uploaded through the secure client portal. Telegram supports messaging, client linking, and reminders only; it does not transfer documents. WhatsApp support requires provider configuration.

### Project Layout

#### Frontend (`apps/desktop/src/`)
- `App.tsx`: Main layout shell (Titlebar, Sidebar, Page Router, Chat).
- `main.tsx`: Entry point.
- `pages/`: Dashboard, Clients, Extract (queue), ExtractionReview, Files, Deadlines, Generate, WhatsApp, OnboardingFlow, Profile, Subscriptions, AuthPage, Other.
- `components/`: Shared UI elements (Icon, Sidebar, Titlebar, Chat, ClientFormCard, FilingTypePicker, ThemeToggle, DocumentPreviewDialog, FileArtifactCard, BrandLogo, AppTour).
- `lib/`: API client (`api.ts`), local AI integration (`openRouter.ts`), utilities (`format.ts`, `cache.ts`, `nativeFiles.ts`, `secureCredentials.ts`, `messageIds.ts`, `pageNavigation.ts`), and domain logic (`domain.ts`).
- `state/`: Global store and action definitions (`store.tsx`).
- `data/`: Seed data for demo mode (`seed.ts`).
- `types.ts`: Shared TypeScript types.

#### Backend (`services/backend/`)
- `index.js`: Entry point; mounts all API routes with global error handling.
- `routes/`: Modular handlers for auth, clientPortal, clients, documents, extraction, messaging (chat), deadlines, generation, templates, notifications, storageCleanup, whatsapp, telegram, metadata, schedules.
- `db/`: Supabase client configuration and connection logic; migration scripts.
- `lib/documentStorage.js`: Private cloud document upload, download, checksum, and deletion helpers.
- `lib/extractionSchema.js`: Strict field/type validation for supported extraction categories (GST, IncomeTax, Form16, BankStatement, Notice, General).
- `lib/invoiceExport.js`: Private, versioned JSON exports for approved GST invoice reviews.

### Key Backend Design Rules (from BACKEND_GUIDE.md)
- **API Response Format**: All routes return `{ success: true, source: "supabase" | "demo", data, count }` or `{ success: false, message }`.
- **Private Supabase Storage**: All document operations use `lib/documentStorage.js`. Bucket must be private; service-role key stays on backend only.
- **Document Lifecycle**: Two-phase deletion (queue cleanup job → remove Storage objects → remove metadata). Replacement uploads create immutable versioned objects.
- **AI Extraction**: Validate against `lib/extractionSchema.js` before saving. Log all AI requests to `ai_usage_log`.
- **Invoice Review**: Human-reviewed GST invoices only. Duplicate supplier/invoice number requires explicit update choice. Durable approval writes versioned JSON snapshot to private `Extracted` folder, verifies checksum, then finalizes.
- **Migrations Order**: Core schema → document lifecycle (`document_lifecycle.sql`, `document_lifecycle_fk_indexes.sql`) → invoice review (`invoice_review_workflow.sql`, `invoice_review_source_idx.sql`) → portal/Telegram migrations → `migrate_cloud_document_storage.sql` → Vault secret deleter.

### Environment Variables
Backend requires (set in `services/backend/.env` or deployment config):
- `DATABASE_URL` — Supabase Postgres connection
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_STORAGE_BUCKET` — Private storage
- `SUPABASE_PUBLISHABLE_KEY` — Client-side Supabase key
- `GEMINI_API_KEY` — Backend AI provider
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` — Telegram integration
- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` — WhatsApp Business API
- `RESEND_API_KEY` — Email notifications
- `CLIENT_PORTAL_URL`, `API_URL` — Portal enrollment links
