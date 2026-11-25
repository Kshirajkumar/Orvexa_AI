# TaxFlow.AI — CA End-to-End Testing Guide (Storage, AI Extraction & Version Control)

This guide walks you through testing **TaxFlow.AI** as a Chartered Accountant (CA) using a **real GST tax invoice** or a **Super Mart shopping bill** (image/PDF). It covers:
1. **Private Cloud Data Storage** (Supabase DB + private Supabase Storage)
2. **AI Data Extraction & Exact Output Formats** (Gemini backend vs. local OpenRouter)
3. **Human Review, Approval & Export**
4. **Data Version Control System** (Physical files, Extraction versions, and Approved Invoice exports)
5. **Two-Phase Deletion & Cleanup**
6. **What’s Working vs. What’s Not (Current Capabilities & Gaps)**

---

## 1. Pre-Flight Setup (Before You Start Testing)

### A. Verify Repository Health
Run these two commands from the repo root to confirm the codebase compiles and unit tests pass:

```powershell
# 1. Backend unit tests
cd services/backend
npm test

# 2. Desktop TypeScript check & production build
cd ../../apps/desktop
npm run build
```

### B. Verify Live Environment Configuration
For full cloud storage, AI extraction, and version control testing (not Demo Mode), ensure `services/backend/.env` has:
- `DATABASE_URL` & `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)
- `SUPABASE_STORAGE_BUCKET=taxflow-intake` (**must be a PRIVATE bucket** in Supabase)
- `SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (for backend AI extraction; alternatively, configure a local **OpenRouter** key in the Desktop app Settings, stored in Windows Credential Manager)

Ensure all Supabase SQL migrations in `services/backend/db/` have been applied in order:
1. Core `schema.sql`
2. `document_lifecycle.sql` and `document_lifecycle_fk_indexes.sql`
3. `invoice_review_workflow.sql` and `invoice_review_source_idx.sql`
4. `migrate_cloud_document_storage.sql`

### C. Start the App
From `apps/desktop/`:
```powershell
npm run dev:full
```
This starts both the Express backend (port `5000` by default) and the Vite/Tauri desktop UI.

---

## 2. End-to-End CA Testing Workflow (Step-by-Step)

### Step 1: Sign In & Create/Select a Test Client
1. Log in as your CA practice account.
2. Open **Clients** from the sidebar and create a test client (e.g., `Test Mart Traders` with a valid email, PAN/GSTIN if applicable, and `Active` status).
3. **What to verify:**
   - The client appears in the list immediately.
   - Refreshing/restarting the app still loads the client from Supabase (`source: "supabase"`).

---

### Step 2: Upload a Real Invoice or Super Mart Bill (Testing Data Storage)
You can upload from **Client Folders** (`Files` page) or **Invoice Extraction** (`Extract` page), or have a client upload via the **Client Portal**.

**Supported File Types & Limits:**
- Allowed extensions for AI extraction: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`
- Maximum file size: **20 MiB** (`20 * 1024 * 1024` bytes)
- Empty files (`0` bytes) are rejected.

**How Storage Works Behind the Scenes:**
1. **Upload Reservation:** Backend calls `begin_document_upload` RPC in Supabase so a concurrent delete cannot remove the file mid-upload.
2. **Private Bucket Upload:** `services/backend/lib/documentStorage.js` verifies the `taxflow-intake` bucket is **private** (never public) and uploads the raw bytes to:
   ```text
   {user_id}/{client_id}/{year}/{month}/Raw/{document_id}_{file_name}
   ```
   *(Note: `Raw`, `Extracted`, and `Generated` are virtual folders inside the private bucket.)*
3. **Metadata & Integrity:** Backend computes the **SHA-256** hash of the file and writes a row to `documents_metadata` + **Version 1** to `document_versions` via `create_document_metadata_if_client_active`.
4. **Rollback Safety:** If metadata registration fails, the backend automatically deletes the uploaded Storage object so no orphaned files remain.

**What to Test Here:**
- [ ] Upload a real **Super Mart bill photo** (`.jpg`/`.png`) or **GST invoice PDF**.
- [ ] Try uploading an unsupported file (e.g., `.exe` or `.txt`) or a file `> 20 MB` -> confirm a clear validation error appears.
- [ ] Click **Open / Preview** in **Client Folders** -> confirm the file downloads through the authenticated backend (`/api/v1/documents/:id/file`) and **no public URL** is exposed.

---

### Step 3: Run AI Data Extraction
1. Go to **Invoice Extraction** (`Extract` page) or click **Extract** on the file inside **Client Folders**.
2. Choose the **Category**:
   - Use **`GST`** for a GST Tax Invoice **or** a Super Mart bill that has GST/CGST/SGST/HSN details.
   - Use **`General`** for a simple Super Mart cash memo / retail receipt without GST breakdown.
   - *(Other supported categories: `Form16`, `IncomeTax`, `ITR1`, `ITR2`, `BankStatement`, `Notice`.)*
3. Click **Start Extraction**.

**How Extraction Works Behind the Scenes:**
- **Backend Gemini Mode (Default):** `POST /api/v1/extraction/process` downloads the file from private Supabase Storage, converts it to base64, sends it to Gemini with `ORVEXA_EXTRACTION_SYSTEM_PROMPT` + category schema prompt, validates the JSON against `packages/extraction-contracts/contracts.json`, logs token usage & cost to `ai_usage_log` and `extraction_runs`, and saves **Extraction Version 1**.
- **Local OpenRouter Mode (Optional):** If enabled in Settings, the desktop app sends the image directly from your machine to OpenRouter using your Windows Credential Manager key, then sends the extracted JSON to `POST /api/v1/extraction/save` for the exact same schema validation and version saving.
- **Duplicate Protection:** If you try to extract the exact same file (matching `file_sha256` for the same client) that is already `Extracted` or `Verified`, the backend blocks the duplicate paid AI call with HTTP `409` (`DUPLICATE_DOCUMENT`).

---

### Step 4: Exact AI Output Format (What the AI Returns)

The AI provider is instructed to return a strict JSON object, which the backend wraps into an **Extraction Envelope** (`extraction_versions.data`).

#### A. Raw AI Response Shape
```json
{
  "data": { ...category fields... },
  "accuracy_score": 0.94,
  "field_confidence": {
    "invoice_number": 0.98,
    "grand_total": 0.99
  },
  "field_evidence": {
    "invoice_number": { "page": 1, "quote": "Bill No: SM-2026-8841" },
    "grand_total": { "page": 1, "quote": "NET PAYABLE: 1,450.00" }
  }
}
```
> **Strict Rules Enforced by `extractionSchema.js`:**
> - Amounts and quantities are JSON **numbers** without commas (e.g., `1450.00`, not `"1,450.00"`).
> - Identifiers (`invoice_number`, `vendor_gstin`, `buyer_gstin`, `hsn_code`, `pan`) are **strings** to preserve leading zeroes.
> - Missing or unreadable fields are `null` (never guessed or invented).
> - Dates use `YYYY-MM-DD` when unambiguous.

#### B. Example 1: Real GST Tax Invoice (`category: "GST"`)
If you upload a B2B/B2C GST invoice, `source_data` (and `extracted_data`) has this exact structure:
```json
{
  "invoice_number": "INV-2026-0412",
  "invoice_date": "2026-11-18",
  "vendor_name": "Apex Office Supplies Pvt Ltd",
  "vendor_gstin": "29AABCA1234F1Z5",
  "buyer_gstin": "29AAACB5678G1Z2",
  "taxable_value": 10000.00,
  "cgst_rate": 9,
  "cgst_amount": 900.00,
  "sgst_rate": 9,
  "sgst_amount": 900.00,
  "igst_rate": null,
  "igst_amount": null,
  "total_gst": 1800.00,
  "grand_total": 11800.00,
  "place_of_supply": "Karnataka (29)",
  "hsn_codes": ["4820", "8471"],
  "line_items": [
    {
      "description": "A4 Copier Paper 75GSM (Box)",
      "hsn_code": "4820",
      "quantity": 10,
      "unit": "BOX",
      "unit_price": 1000.00,
      "taxable_value": 10000.00,
      "gst_rate": 18,
      "cgst_amount": 900.00,
      "sgst_amount": 900.00,
      "igst_amount": 0,
      "total_amount": 11800.00
    }
  ]
}
```

#### C. Example 2: Super Mart Shopping Bill
You can test a Super Mart receipt in two ways:
1. **If the Super Mart bill has GSTIN & tax breakup -> use `category: "GST"`:**
   - `vendor_name`: `"Reliance Smart Superstore"` (or `"D-Mart"` etc.)
   - `vendor_gstin`: `"27AAACR..."`
   - `buyer_gstin`: `null` (B2C retail bill)
   - `line_items`: Each grocery/household item with `description`, `hsn_code`, `quantity`, `unit_price`, `gst_rate`, `cgst_amount`, `sgst_amount`, `total_amount`.
   - `taxable_value`, `cgst_amount`, `sgst_amount`, `total_gst`, `grand_total`.
2. **If the Super Mart bill is a simple thermal receipt with no GST breakup -> use `category: "General"`:**
   ```json
   {
     "document_type": "Supermarket Receipt",
     "document_date": "2026-11-20",
     "names": ["FreshMart Supermarket"],
     "identifiers": { "bill_no": "POS-04-9921" },
     "amounts": { "subtotal": 820.00, "discount": 20.00, "grand_total": 800.00 },
     "line_items": [
       { "description": "Basmati Rice 5kg", "quantity": 1, "amount": 550.00 },
       { "description": "Sunflower Oil 1L", "quantity": 2, "amount": 270.00 }
     ],
     "other_fields": [{ "payment_mode": "UPI" }],
     "unreadable_fields": []
   }
   ```

#### D. What the Backend Saves in `extraction_versions.data` (The Full Envelope)
Along with your `source_data`, the backend builds a complete audit envelope (`services/backend/lib/extractionVersioning.js`):
- `fields`: Canonicalized key-value map with `value`, `raw_label`, `raw_text`, `confidence`, `page`, and `status` (`found` / `not_present` / `ambiguous`).
- `overall_score`:
  - `provider_score` / `model_confidence`: Average AI reading confidence (`0` to `1`).
  - `completeness`: Ratio of non-null fields.
  - `review_score`: Ratio of fields with confidence `>= 0.80` and no warnings, minus warning penalties.
- `needs_review`: Auto-flagged list of fields that are missing, have warnings, or have confidence `< 0.80`.
- `warnings`: Quality validation warnings from `extractionValidation.js` (e.g., GST math mismatch or invalid GSTIN format).

---

### Step 5: Human Review & Approval (`Extraction Review` Page)
1. Click **Review & Edit** on the extracted document to open **Data Extraction Review**.
2. **Side-by-Side Verification:** The original bill/invoice preview loads on one side; editable fields load on the other.
3. **Edit a Field:** Intentionally change a value (e.g., fix a typo in `vendor_name` or adjust `grand_total`) to test human correction.
4. **Approve:**
   - **For `GST` category:** Clicking **Approve** calls `POST /api/v1/extraction/review`.
     - Checks for duplicate `vendor_gstin` + `invoice_number` (`DUPLICATE_MATCH`) or already-approved source file (`DUPLICATE_EXACT`).
     - If a duplicate invoice exists, the UI asks whether you want to **Update Existing Invoice** (which increments the invoice version) or cancel.
     - Writes an immutable, checksum-verified JSON snapshot to the client's private **`Extracted`** folder:
       `invoice_{invoiceRecordId}.json`
     - Finalizes status to **`Verified`** only after the Storage upload + SHA-256 checksum verification succeed.
   - **For non-GST categories (`General`, `Form16`, etc.):** Clicking **Verify** calls `POST /api/v1/documents/:id/verify`, saving your edited data as a new `edit` extraction version and marking the document `Verified`.

---

## 3. Testing the Data Version Control System

TaxFlow.AI has **three separate version control layers**. Here is how each works and how to test it:

### Layer 1: Physical Document Version Control (Testable in UI)
When a client sends an updated/clearer scan of the same bill, you **never overwrite** the old file bytes.
- **How to test in Desktop UI (`Client Folders` -> select document):**
  1. Click **Version history** to see `v1` (the original upload, with its SHA-256 and timestamp).
  2. Click **Replace version** and upload a new image/PDF (e.g., a clearer photo of the Super Mart bill).
  3. **Verify:**
     - A new immutable object is stored at `{user_id}/{client_id}/documents/{document_id}/{version_id}_{file_name}`.
     - **Version history** now lists `v1` and `v2`.
     - Clicking **Download / Open** on `v1` still downloads the original file; `v2` downloads the replacement.
  - **Note:** Editing a document's name, category, or assessment year (`PATCH /api/v1/documents/:id`) updates metadata only and does **not** create a new physical file version.

### Layer 2: AI Extraction Version Control (Backend & `api.ts` Ready — Test via API)
Every AI run (`ai`, `ai_rerun`), human correction (`edit`), and restore (`restore`) creates an immutable row in `extraction_versions` (`v1`, `v2`, `v3`, ...).
- **Important Status Note:** The backend routes (`/api/v1/extraction/versions/:documentId`, `/compare`, `/restore`) and frontend API helpers (`fetchExtractionVersions`, `compareExtractionVersions`, `restoreExtractionVersion` in `apps/desktop/src/lib/api.ts`) are **implemented**, but **Compare & Restore buttons are not yet wired into the `ExtractionReview.tsx` UI**.
- **How to test via PowerShell (using your logged-in Bearer token and `documentId`):**

```powershell
$token = "<YOUR_SUPABASE_ACCESS_TOKEN>"
$docId = "<YOUR_DOCUMENT_UUID>"
$headers = @{ Authorization = "Bearer $token" }

# 1. List all extraction versions (v1 = AI, v2 = your manual edit, etc.)
Invoke-RestMethod -Uri "http://localhost:5000/api/v1/extraction/versions/$docId" -Headers $headers | ConvertTo-Json -Depth 6

# 2. Compare Version 1 (AI) vs Version 2 (Human Edit)
Invoke-RestMethod -Uri "http://localhost:5000/api/v1/extraction/versions/$docId/compare?from=1&to=2" -Headers $headers | ConvertTo-Json -Depth 6

# 3. Restore Version 1 (creates a NEW immutable Version 3 with version_kind='restore', never overwrites v1/v2)
$body = @{ versionNumber = 1; expectedCurrentVersion = 2; note = "Reverting to original AI read" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/v1/extraction/versions/$docId/restore" -Headers $headers -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```
- **What to verify:**
  - Restoring `v1` creates `v3` (`version_kind: "restore"`), preserves `v1` and `v2` intact, and resets the document status so it requires human review again.

### Layer 3: Approved GST Invoice Export Versioning (Testable in UI)
- When you approve a GST invoice, `invoice_records` tracks `current_version`, `invoice_review_versions` stores the diff/review history, and `Extracted/invoice_{id}.json` is written.
- **How to test:**
  1. Approve a GST invoice -> check the client's **`Extracted`** folder in **Client Folders** for `invoice_<id>.json` (`v1`).
  2. Upload a revised invoice with the **same `vendor_gstin` and `invoice_number`**, extract it, and click **Approve**.
  3. Confirm the UI warns you of `DUPLICATE_MATCH` and offers to update the existing invoice.
  4. Confirm the update -> `invoice_records.current_version` increments to `2` and a new immutable version is appended to `document_versions` for `invoice_<id>.json`.

---

## 4. Testing Two-Phase Deletion & Cleanup
1. In **Client Folders**, delete a test document.
2. **What happens:**
   - The document disappears from normal reads immediately (`deletion_requested_at` is set).
   - A `storage_cleanup_jobs` row is created.
   - The backend cleanup worker deletes the private Storage object(s) first, and **only then** removes the database metadata.
3. **What to verify:**
   - If Storage cleanup succeeds, the job completes automatically.
   - If you simulate a failure (or inspect `/api/v1/storage-cleanup`), the **Cloud cleanup** panel in `Client Folders` shows job status and provides **Check status** and **Retry cleanup** buttons.

---

## 5. What's Working vs. What's Not (Quick Reference)

| Capability | Status | Where / How to Test |
| :--- | :--- | :--- |
| **Client CRUD & Ownership Isolation** | **Working** | `Clients` page (requires live Supabase) |
| **Private Cloud Storage (`Raw`, `Extracted`, `Generated`)** | **Working** | `Client Folders` / `Extract` / Client Portal (`taxflow-intake` private bucket) |
| **AI Extraction (Gemini Backend & Local OpenRouter)** | **Working** | `Extract` page & `Client Folders` (requires API key + live Supabase) |
| **Strict Schema Validation & Confidence Scoring** | **Working** | Automatic on every extraction (`contracts.json` + `extractionVersioning.js`) |
| **Human Review, Edit & GST Approval + JSON Export** | **Working** | `Extraction Review` page (`Extracted/invoice_<id>.json`) |
| **Physical File Version History & Replacement** | **Working in UI** | `Client Folders` -> `Version history` & `Replace version` |
| **Two-Phase Deletion & Cleanup Retry UI** | **Working in UI** | `Client Folders` -> Delete -> `Cloud cleanup` panel |
| **Extraction Version History / Compare / Restore** | **Backend Ready, No UI Buttons Yet** | Test via `/api/v1/extraction/versions/:id`, `/compare`, `/restore` |
| **Telegram Document Transfer** | **Intentionally Disabled** | Telegram is text/reminders only; directs clients to the secure Client Portal |
| **Official GSTR-1 / GSTR-3B / ITR Filing & Tally Sync** | **Not Implemented (Roadmap)** | Approved `invoice_<id>.json` is an internal record, not a government filing artifact |
| **Multi-Staff Roles / Maker-Checker Permissions** | **Not Implemented (Roadmap)** | Single-practice-owner model currently |
