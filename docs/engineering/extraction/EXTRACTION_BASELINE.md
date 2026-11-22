# TaxFlow.AI Extraction Reliability Baseline

**Baseline date:** 22 November 2026
**Repository baseline:** commit `282367d` before the P0 reliability patch
**Scope:** backend extraction, extraction-version persistence, document ownership, and existing regression tests.

## Evidence captured

- Backend test suite before this tranche: 87 passing tests.
- Desktop production build before this tranche: passed with `npm.cmd run build`.
- The repository uses imperative SQL files under `services/backend/db/`; it does not contain a Supabase declarative schema directory or migration history directory.
- The current extraction version function is `public.save_extraction_version(...)` in `services/backend/db/extraction_versioning.sql`.
- Extraction versions and events are backend/service-role operations; `anon` and `authenticated` are revoked from the related tables and RPCs.

## Confirmed P0 defects before the patch

| ID | Finding | Evidence | Initial status |
|---|---|---|---|
| EX-01 | Version saving called `digest()` without the `extensions` schema while the function pins `search_path` to `pg_catalog, public`. | `services/backend/db/extraction_versioning.sql` | Fixed in repository; staging/database execution still required |
| EX-02 | `/extraction/process` catch handling updated `documents_metadata` by document ID without the verified client scope. | `services/backend/routes/extraction.js` | Fixed in repository; cross-tenant live DB test still required |
| EX-03 | GST extraction bypassed `save_extraction_version`, unlike other supported categories. | `services/backend/routes/extraction.js` | Fixed in repository; staging verification still required |
| EX-04 | Processing-state update and success update did not consistently check the verified client scope or update errors. | `services/backend/routes/extraction.js` | Fixed in repository |
| EX-05 | Missing category fallback in the backend defaulted to GST. | `services/backend/routes/extraction.js` | Fixed to use `General`; full category registry remains roadmap work |

## Not verified in this baseline

- No production or staging Supabase migration was run from this checkout.
- A read-only inspection of the connected Taxflow-Ai Supabase project confirmed migration drift; see `docs/engineering/extraction/STAGING_VERIFICATION.md`.
- No real client documents or provider credentials were used.
- Provider retry behavior and data-quality checks were verified with deterministic unit tests; behavior against the real Gemini service remains unverified.
- Full extraction accuracy, field-level evidence, background processing, shared schema registry, and golden-document evaluation remain separate workstreams.

## P1 work now present in the repository

- `packages/extraction-contracts/contracts.json` is the shared versioned schema source consumed by both backend validation and desktop OpenRouter validation.
- Unsupported categories such as `TDS` and `Audit` now fail explicitly instead of silently using the `General` contract.
- Category-aware aliases preserve the original source label and place unknown labels in `extra_fields` instead of counting them as validated canonical fields.
- Extraction history has separate authenticated APIs for listing, comparing, and restoring versions. Restore creates a new immutable version and uses optimistic concurrency.
- Non-GST approval without edits now approves the latest extraction version when one exists; legacy documents without extraction history retain the prior verification path.
- Provider attempts now have durable `extraction_runs` metadata, including provider/model, schema and prompt versions, timing, token/cost fields, request ID, status, and usage provenance. The existing usage log is treated as observability and cannot turn a successful extraction into a failed request on an older deployment that has not added `usage_source` yet.
- Provider calls now use a bounded two-attempt retry policy for transient HTTP failures and a per-attempt timeout; non-transient client failures are not retried.
- Extraction results now retain review warnings for malformed PAN, GSTIN, TAN, IFSC, HSN, invalid ISO dates, and inconsistent GST totals without silently altering extracted values.
- Corrected-data approval now uses the `approve_extraction_data` service-role RPC to create the edit version, mirror source data, and mark the same version approved within one database transaction.
- Provider page/quote evidence is preserved on canonical version fields when supplied; missing evidence remains visible as missing rather than being fabricated.
- Partial extraction is now accepted when returned fields are a strict known-field subset, and an explicit provider confidence of `0` is preserved instead of being replaced by a fallback score.
- Provider JSON parsing is bounded and accepts only an object, with support for fenced output and short surrounding commentary; it does not rewrite malformed field values.
- Unsupported MIME types are rejected before a durable extraction run is created, preventing stranded `processing` run records.

These changes are repository-verified only. They do not yet prove extraction accuracy against a golden-document set, validate provider-specific response quality, or prove the new RPCs against a staging database.

## Safe deployment order for this tranche

1. Back up the target database and verify restoration before applying SQL.
2. Confirm `pgcrypto` is installed in the `extensions` schema and that the service-role migration runner can execute the function replacement.
3. Apply the existing extraction schema, then `services/backend/db/extraction_versioning_digest_fix.sql`, then `services/backend/db/extraction_runs.sql`.
4. Run the verification queries and cross-tenant tests against staging.
5. Deploy the backend code only after the staging RPC, ownership checks, and durable-run inserts pass.
6. Monitor extraction failures, version creation, run completion, and usage-log compatibility before production rollout.

## Rollback

The SQL change is a `CREATE OR REPLACE FUNCTION` compatibility repair and does not remove rows or change public signatures. If rollback is necessary, restore the prior function definition from the repository commit only after confirming the original digest-resolution failure is not reintroduced. The application change can be rolled back to the previous backend commit without changing document IDs or Storage object paths.
