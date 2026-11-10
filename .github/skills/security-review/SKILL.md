---
name: security-review
description: 'Review TaxFlow.AI code for exploitable security weaknesses across React/Tauri, Express, Supabase Auth/Postgres/Storage, document handling, and AI integrations. Use for security audits, vulnerability reviews, or questions such as "is this secure?".'
---

# TaxFlow Security Review

Perform a read-only, evidence-based security review of the requested scope. Do not attempt to exploit production systems, access live customer data, or modify code unless the user separately asks for fixes.

## Workflow

1. Establish the requested scope. Check the worktree and diffs first; distinguish the requested changes from unrelated pre-existing modifications. If no scope is given, review the repository and identify what could not be covered.
2. Read the applicable architecture guidance, especially `CLAUDE.md`, `BACKEND_GUIDE.md`, and `DESIGN_GUIDE.md`.
3. Trace relevant trust boundaries through callers and callees. Follow user-controlled data from UI, HTTP, webhooks, uploads, and extracted documents through validation, authorization, storage, and output.
4. Prioritize checks that fit this application:
   - Authentication, per-user/client/document authorization, invitation and portal lifecycle, and cross-tenant access.
   - Express request validation, SQL/query construction, error responses, webhook verification, and sensitive endpoint abuse controls.
   - Private Supabase Storage access, ownership and object-key checks, upload limits, MIME/content handling, and durable deletion/version workflows.
   - Service-role keys and other secrets staying on the backend; secret leakage through frontend bundles, logs, errors, or API responses.
   - React rendering of untrusted data, Tauri/native boundaries, AI prompts and document data flows, and unsafe generated output.
   - SQL migrations, RLS or other access controls, unsafe defaults, and security-sensitive demo-mode behavior.
5. Verify each candidate against the actual code and its surrounding protections. Confirm reachability, attacker control, missing mitigations, and realistic impact. Discard speculative or duplicate findings.
6. Report only actionable issues with precise file and line references. Rank by severity and confidence; explain the affected trust boundary and a minimal remediation. Do not include live secrets or weaponized exploit instructions.

## Report

Use this table, with findings ordered by severity and then confidence:

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🔴 CRITICAL / 🟠 HIGH / 🟡 MEDIUM / ⚪ LOW | path | line numbers | Concise impact and evidence | 1-10/10 |

If no issues are confirmed, say so and list the areas reviewed and any meaningful coverage gaps. Clearly distinguish verified vulnerabilities from hardening suggestions. Do not apply fixes without the user's approval.

## Safe verification

Prefer source inspection and existing local tests. Use only authorized local or test environments for further checks; never send test payloads to production or third-party systems. Do not print, copy, or commit credentials.

## Source

TaxFlow-specific workflow informed by the MIT-licensed `security-review` skill in [github/awesome-copilot](https://github.com/github/awesome-copilot/tree/main/skills/security-review). That repository had about 40,998 stars when checked on 2026-11-10; stars are a repository-level signal, not a skill rating.
