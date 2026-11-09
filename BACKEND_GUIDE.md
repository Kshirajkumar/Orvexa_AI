# BACKEND_GUIDE.md

This document defines the architectural standards, design rules, and implementation patterns for the TaxFlow.AI backend. All new routes, database changes, and storage logic must adhere to these rules to ensure system stability, security, and consistency.

## 1. High-Level Architecture

TaxFlow.AI stores structured records in Supabase Database and all client document binaries in a private Supabase Storage bucket.

### The Data Flow
`Frontend Request` $\rightarrow$ `Express Route` $\rightarrow$ `(Supabase Metadata + private Supabase Storage)` $\rightarrow$ `Standardized JSON Response`

- **Supabase Database**: Stores structured metadata, relationships, logs, extracted values, and state.
- **Supabase Storage**: Private durable source for client uploads, staff uploads, and generated documents. The backend accesses the bucket using its server-only service-role key.
- **Desktop**: Uses the authenticated backend API for listing, uploading, downloading, and deleting documents; it does not configure or sync a local vault.

---

## 2. API Design Standards

### 2.1 Endpoint Structure
All endpoints must be versioned and modularized by domain.
- **Base Path**: `/api/v1/`
- **Naming**: Use plural nouns for resources (e.g., `/api/v1/clients`, `/api/v1/documents`).
- **Methods**: 
    - `GET`: Retrieve data.
    - `POST`: Create new records or trigger complex actions (e.g., AI processing).
    - `PATCH/PUT`: Update existing records.
    - `DELETE`: Remove records (usually marked as `deleted: true` rather than hard deletion).

### 2.2 Standard Response Format
To ensure the frontend can handle responses predictably, all routes **must** return a JSON object with this structure:

**Success Response:**
```json
{
  "success": true,
  "source": "supabase" | "demo",
  "data": { ... },
  "count": 123
}
```

**Failure Response:**
```json
{
  "success": false,
  "message": "Clear, human-readable error description"
}
```

### 2.3 Error Handling
- **Global Handler**: Use the global error middleware in `index.js` for unexpected crashes.
- **Status Codes**:
    - `200 OK`: Standard success.
    - `201 Created`: Successful POST.
    - `400 Bad Request`: Validation errors.
    - `401 Unauthorized`: Auth failures.
    - `404 Not Found`: Missing resource.
    - `500 Internal Server Error`: Unhandled exceptions.

---

## 3. Data Management Rules

### 3.1 Supabase (Metadata)
- **Service Role**: Use the `service_role` key for administrative backend operations.
- **Demo Mode**: Every route must check `isConnected` from `db/supabase.js`. If false, provide a fallback to in-memory demo data to ensure the app remains runnable locally.
- **Client List Cache**: The authenticated client-list route may cache results in memory per user. Invalidate that cache after successful client creation, update, or deletion. The desktop may show its last-known per-user client list while refreshing in the background; a backend restart clears the server cache. Changes made outside the app are reflected after that cache is cleared or the backend restarts.

### 3.2 Private Supabase Storage

All document uploads and generated files must use `lib/documentStorage.js`. The helper validates the configured bucket is private, limits content to 20 MiB, and uses account/client/document-scoped object keys. Keep the service-role key on the backend only; never expose bucket credentials or public URLs to the desktop app. Validate client ownership and the expected object key before every read or delete. Record the bucket, object path, MIME type, and SHA-256 in `documents_metadata` only after a successful upload. On metadata failure, remove the uploaded object and report cleanup failures explicitly. Existing local files must be migrated and checksum-verified before their source copies are removed.

Cloud objects use `{user_id}/{client_id}/{year}/{month}/{Raw|Extracted|Generated}/{document_id}_{file_name}` keys. Client creation initializes virtual `Raw` and `Extracted` folders for the creation month in the Files page; no empty placeholder objects are uploaded. Portal and staff source uploads use `Raw`, while documents explicitly categorized as `Extracted` or `Generated` use their matching folders. AI-extracted fields remain in `documents_metadata` and related records; they are not separate files unless an export is generated.

1. **Telegram**: Telegram is a text and connection channel only. The relay forwards Telegram's media update metadata to the backend, but neither service downloads or stores file bytes. For a linked active client in a private chat, the backend sends a short privacy warning and a secure portal link: clients without an active portal account receive their current private, single-use invitation; clients with an active portal account receive the normal `/portal` sign-in link. It stores only the sanitized outbound notice. Unlinked, inactive, group-chat, and sender-mismatch media is ignored. New client documents must be uploaded through the secure client portal. Historical Telegram file records are retained for audit continuity but are not listed, extracted, served, or downloaded.
2. **Client Portal Uploads**: Clients enroll only through a CA-issued, single-use invitation link, create a password for the exact email on their active client record, and use password sign-in for later visits. Changing a client's email revokes outstanding invitations and disconnects the previous portal user; the backend deletes the old Auth user only when its portal-specific marker is verified and it is not linked to another active client. CA/staff Auth users are never deleted by client email changes. The backend creates a fresh invitation for the new email and, when the client has a linked Telegram chat, sends a tracked notice explaining the old login is disconnected and the new email must be used to enroll. If Telegram is unavailable or unlinked, the authenticated CA receives a copyable invitation and an explicit warning to deliver it privately. Existing documents remain attached to the client record. Supabase Auth emails are unique: do not use a CA/staff login email as a client email; choose a separate email address. The invitation table stores the token hash and, when needed for a Telegram notification, an authenticated-encrypted token ciphertext that only the backend can decrypt to resend the same active client-specific link. Raw invitation tokens are never stored in plaintext. Invite URLs are redacted from Telegram message history, and the token is removed from the browser URL fragment before any API call. Any messaging provider used to share an invitation link may retain it, so treat it as a bearer credential and share it only with the intended client. The portal API requires a portal-specific Auth identity and a claimed active access record, and rechecks the current client email and active status on every request. Uploads are size-limited, type/signature checked, rate-limited, and accepted only when `SUPABASE_STORAGE_BUCKET` exists and Supabase reports it as private. The backend records metadata and SHA-256 in `documents_metadata`; staff can review and download the files through the authenticated backend API. Portal files are never transferred through Telegram.

Before enabling Telegram or the client portal on an existing database, ensure `clients`, `user_profiles`, and `documents_metadata` exist, then run `npm run migrate:telegram` from `services/backend` with `DATABASE_URL` set. That command applies the existing Telegram and portal migrations. Then apply `services/backend/db/migrate_cloud_document_storage.sql` to the same Supabase project to make metadata compatible with cloud-only uploads and retire the desktop sync queue. This migration is separate from historical migrations so existing project history is preserved. To transfer existing local files, set `VAULT_PATH` and run `npm run migrate:storage`; it verifies cloud copies by SHA-256 and does not delete source files. Resolve every reported failure before removing legacy data. Keep `SUPABASE_STORAGE_BUCKET=taxflow-intake` private, set `SUPABASE_SERVICE_ROLE_KEY` and `TELEGRAM_WEBHOOK_SECRET` on the backend, and never grant `anon` or `authenticated` access to the private bucket or expose the service-role key.

Telegram media is not a supported document-transfer method. Do not configure Telegram-specific Storage policies or manually grant access to `storage.objects`; historical Telegram files remain retained but unavailable through application document APIs. The private `SUPABASE_STORAGE_BUCKET` stores portal and staff uploads plus generated documents. The backend checks bucket privacy before accepting each upload. Do not grant `anon` or `authenticated` access to the bucket or expose the service-role key.

Before enabling client-portal uploads, apply the existing database schema, `services/backend/db/telegram.sql`, `services/backend/db/telegram_document_storage.sql`, `services/backend/db/create_taxflow_storage_bucket.sql`, `services/backend/db/client_portal.sql`, `services/backend/db/client_portal_invites.sql`, `services/backend/db/create_api_rate_limits.sql`, and `services/backend/db/decommission_telegram_file_transfer.sql`. Running `npm run migrate:telegram` applies the messaging and portal migrations in order, then removes Telegram attachment workflow fields while preserving historical document rows and Storage objects. Configure `CLIENT_PORTAL_URL` to the HTTPS website origin and set the website's public Supabase URL/key plus `API_URL`. Portal enrollment creates confirmed Supabase Auth users on the server only after a valid invitation is checked; it does not use Supabase email sign-in or invitation links. Apply all portal migrations before deploying backend code that enforces staff/client identity separation.

For portal enrollment, a CA uses **Connect client** for an active client with a valid email address. The backend creates and stores the hashed Telegram start token before returning the Telegram link. When the client starts the bot and the Telegram account is linked, TaxFlow creates the client-specific portal invitation in the database, then sends a text-only welcome message followed immediately by a second message containing the private portal invitation and enrollment instructions. The client creates an account with the exact email on the client record and a password; later sign-ins use that password. A valid invitation is consumed transactionally when the authenticated client claims it. Do not allow email-only auto-binding. Apply `services/backend/db/message_templates.sql` after the base schema to enable per-practice inbox templates. Core templates can be edited but not deleted, and all template messages receive the portal page link; do not use Telegram to transmit sensitive files.

### Account Deletion
The authenticated Settings flow requires the current password and the exact confirmation phrase `DELETE MY ACCOUNT`. The backend removes private objects from `SUPABASE_STORAGE_BUCKET` and metadata-linked buckets, deletes account-owned Supabase Vault secrets, then deletes the Supabase Auth user; database foreign keys cascade account-owned rows. Configure `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` only on the backend. Never put these keys in the desktop application.

Before enabling account deletion on an existing Supabase project, apply `services/backend/db/create_vault_secret_deleter.sql` after enabling Supabase Vault and applying `services/backend/db/create_integration_secrets.sql`. Make sure the other schema migrations are current, too. In particular, run `services/backend/db/delete_client_cascade.sql` if the database predates the client deletion migration; direct user-owned tables must use `ON DELETE CASCADE` as defined by `services/backend/db/schema.sql`, `services/backend/db/create_notifications.sql`, `services/backend/db/create_integration_secrets.sql`, and the Telegram sync migrations. Do not delete an Auth user until the backend is deployed with Storage and Vault cleanup enabled. Legacy local source files are intentionally preserved by the cloud migration; remove them only after migration verification and retention review. Account deletion also cannot revoke credentials at external providers. If cleanup succeeds but Auth deletion fails, the account remains sign-in capable while some cloud files or Vault secrets may already be gone; correct the foreign-key/configuration issue and retry.

#### Document Storage Flow:
- **Upload**: Validate ownership and file content, upload to the private bucket, then insert the metadata row.
- **Serving**: Validate ownership and the canonical object key, download from private Storage, and return a non-cacheable response.
- **Deletion**: Remove the owned cloud object and metadata; report partial failures rather than claiming success.

---

## 4. Integration Patterns

### 4.1 AI (Google Gemini)
- **Provider routing**: Standard extraction and chat use the backend Gemini integration. When a user enables local OpenRouter-key mode, the desktop sends extraction images directly to OpenRouter; the original upload is still stored in private Supabase Storage first.
- **Extraction output**: Validate extracted fields against the category schema before saving. Keep the structured result in Supabase document metadata. Do not invent confidence scores or return sample extraction data as a successful AI result.
- **Logging**: Every AI request must be logged in the `ai_usage_log` table in Supabase for auditing and cost tracking.

### 4.2 WhatsApp Business API
- **Webhook Handling**: Incoming messages must be processed asynchronously and stored in `whatsapp_msgs`.
- **Outgoing**: Use a standardized template system to ensure consistent client communication.

---

## 5. Implementation Checklist for New Features

Follow these steps when adding a new backend feature:

- [ ] **Database**: Create the necessary table/column in Supabase.
- [ ] **Storage**: Use the private bucket helper and update metadata constraints when a new document category is required.
- [ ] **Route**: Create a new route file in `routes/` and mount it in `index.js`.
- [ ] **Logic**:
    - [ ] Implement `isConnected` check for Demo Mode.
    - [ ] Use `lib/documentStorage.js` for document operations.
    - [ ] Wrap logic in `try-catch` blocks.
- [ ] **Response**: Ensure the return object matches the `{ success, source, data }` format.
- [ ] **Frontend**: Update the React store/services to call the new endpoint.
