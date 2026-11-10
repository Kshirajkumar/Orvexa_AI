# CLAUDE.md

TaxFlow.AI is a Tauri desktop application with a React/TypeScript frontend and an Express/Supabase backend. The product currently supports practice management, private document storage, human-reviewed extraction, compliance tracking, and messaging. It does not yet provide certified tax filing or government submission.

## Development Commands

### Desktop (React + TypeScript + Vite + Tauri)
Run from `apps/desktop`: `npm install`, `npm run dev`, `npm run build`, `npm run preview`, or `npm run tauri dev`.
`npm run dev:full` starts the Vite UI and backend together.

### Backend (Node.js + Express)
Run from `services/backend`: `npm install`, `npm run dev`, or `npm start`.
Run backend tests with `npm test` (`node --test test/*.test.js`).

## Architecture & Structure

TaxFlow.AI is a full-stack practice suite for tax professionals, consisting of a React frontend and a Node.js backend.

### High-Level Architecture
- **Frontend**: Pages live in `apps/desktop/src/pages/`; shared state uses React Context and `useReducer` in `src/state/store.tsx`. Styles are in `src/styles.css`. `src/lib/api.ts` calls the backend; `src/lib/openRouter.ts` implements the optional local OpenRouter extraction mode.
- **Backend**: `services/backend/index.js` mounts Express routes. Supabase Postgres stores metadata, extraction results, invoice review history, and messaging state. Document bytes use private Supabase Storage through `lib/documentStorage.js`.
- **AI**: Backend extraction uses the configured Gemini provider; local OpenRouter-key extraction results are validated and saved through the backend. Extracted data is reviewed before approval.
- **Intake and messaging**: Client documents are uploaded through the secure client portal. Telegram supports messaging, client linking, and reminders only; it does not transfer documents. WhatsApp support requires provider configuration.

### Project Layout

#### Frontend (`apps/desktop/src/`)
- `App.tsx`: Main layout shell (Titlebar, Sidebar, Page Router, Chat).
- `pages/`: Dashboard, clients, extraction queue/review, files, deadlines, generation, WhatsApp, onboarding, profile, subscriptions, and authentication.
- `components/`: Shared UI elements (Icon, Sidebar, Titlebar, Chat).
- `lib/`: API client, local AI integration, utilities (`format.ts`), and domain logic (`domain.ts`).
- `state/`: Global store and action definitions.
- `data/`: Seed data for demo mode.

#### Backend (`services/backend/`)
- `index.js`: Entry point; mounts all API routes.
- `routes/`: Modular handlers for auth, client portal, clients, documents, extraction, messaging, deadlines, generation, templates, notifications, and storage cleanup.
- `db/`: Supabase client configuration and connection logic.
- `lib/documentStorage.js`: Private cloud document upload, download, checksum, and deletion helpers.
- `lib/extractionSchema.js`: Strict field/type validation for supported extraction categories.
- `lib/invoiceExport.js`: Private, versioned JSON exports for approved GST invoice reviews.

Invoice approval requires the core schema, document-lifecycle migrations, and `db/invoice_review_workflow.sql` plus `db/invoice_review_source_idx.sql`. See the root README and `BACKEND_GUIDE.md` for migration order and security requirements.
