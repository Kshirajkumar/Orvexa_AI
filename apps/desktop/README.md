# TaxFlow.AI Desktop

The desktop client is a React 18 and TypeScript application built with Vite and wrapped with Tauri v2. It connects to the Express API in `services/backend`; cloud storage, authentication, and server-side AI features require a configured backend and Supabase project.

## Requirements

- Node.js 18 or newer and npm
- Rust stable and the platform build tools when building the native Tauri app
- Backend credentials and Supabase migrations for cloud-backed workflows
- Windows Credential Manager for the optional local OpenRouter-key mode

## Development

Install dependencies and run the desktop Vite server:

```bash
npm install
npm run dev
```

From `apps/desktop`, `npm run dev:full` starts the Vite UI and backend together. To run the Tauri desktop shell, start the backend separately from `services/backend` with `npm run dev`, then run this from `apps/desktop`:

```bash
npm run tauri dev
```

Configure backend secrets in `services/backend/.env` using `.env.example` as a reference. Keep Supabase service-role keys and provider credentials on the server; do not put them in the desktop app.

## Build

```bash
npm run build       # TypeScript check and Vite production build
npm run preview     # Preview the web production build
npm run tauri build # Build a native installer
```

## Application areas

- `src/pages/`: dashboard, clients, files, extraction queue and review, deadlines, generation, messaging, onboarding, profile, and subscriptions
- `src/components/`: shared navigation, titlebar, icons, and chat UI
- `src/state/`: React Context and reducer-backed application state
- `src/lib/`: API client, local OpenRouter integration, formatting, and domain helpers
- `src-tauri/`: Tauri configuration and native Rust integration

GST invoice approval is a cloud workflow: duplicate checks and versioned JSON exports are handled by the backend and require the invoice-review database migrations described in the repository [README](../../README.md#database-setup--migrations). In the optional Windows OpenRouter-key mode, extraction images are sent directly from the desktop to OpenRouter. The current app does not submit tax filings to government portals.
