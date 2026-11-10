---
name: code-review
description: 'Review TaxFlow.AI changes for correctness, regressions, security, data integrity, and maintainability. Use for code reviews, diff reviews, pre-merge checks, or requests to find issues without making changes.'
---

# TaxFlow Code Review

Review the requested changes without editing files. Report confirmed, user-impacting findings rather than style preferences or speculative concerns.

## Workflow

1. Check `git status` and the relevant staged, unstaged, and untracked files. Respect unrelated worktree changes; do not assume every changed file belongs to this review.
2. Identify the requested base, requirements, and affected behavior. Read adjacent callers, data contracts, and relevant guidance in `CLAUDE.md`, `BACKEND_GUIDE.md`, or `DESIGN_GUIDE.md`.
3. Trace important flows across layers: React state and API calls, Express routes and response shapes, Supabase or demo-mode behavior, and document storage. Check that callers and error paths still behave correctly.
4. Look for defects in:
   - Logic, validation, boundary conditions, async/error handling, and type/contracts.
   - Authentication/authorization, tenant ownership, data exposure, and untrusted input.
   - Persistence consistency, upload/download/delete lifecycle, migrations, and demo fallbacks.
   - UI state, accessibility, and responsive behavior when the change touches the desktop UI.
   - Performance or maintainability only when there is a concrete, material consequence.
5. Verify each finding in context and check whether existing helpers, middleware, tests, or constraints already prevent it. Use line numbers from the current file, not just diff positions.
6. Run the smallest relevant existing check when practical. Run the desktop production build for relevant frontend changes; inspect backend scripts before relying on them. State commands that were not run and why.

## Findings

Order confirmed defects by severity and confidence:

- **CRITICAL** — likely compromise, major unauthorized data access, or irreversible data loss.
- **HIGH** — serious security, correctness, or reliability failure with a realistic trigger.
- **MEDIUM** — bounded user-visible defect or important edge-case failure.
- **LOW** — minor defect with limited impact.

For each finding include severity, `file:line`, the triggering condition, concrete impact, and the smallest reasonable fix. Include confidence from 1-10. Do not report unsubstantiated risks as findings; put useful non-blocking suggestions in a separate short section.

If no findings are confirmed, say so and summarize the scope reviewed, checks run, and any important gaps. Do not implement fixes unless asked.

## Source

TaxFlow-specific workflow informed by the MIT-licensed `code-review-expert` skill in [sanyuan0704/sanyuan-skills](https://github.com/sanyuan0704/sanyuan-skills/tree/main/skills/code-review-expert). That repository had about 3,979 stars when checked on 2026-11-10; stars are a repository-level signal, not a skill rating.
