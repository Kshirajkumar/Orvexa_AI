---
name: bug-finder
description: 'Find and investigate functional bugs, regressions, and unexpected behavior in TaxFlow.AI code or diffs. Use when asked to find bugs, diagnose a failure, or trace an issue to its root cause.'
---

# TaxFlow Bug Finder

Find evidence for the defect before proposing a fix. Keep investigations safe and scoped; do not change code unless the user asks for a fix.

## Workflow

1. Establish the reported or expected behavior and the actual symptom. Record the smallest useful input, exact error/output, and affected page, endpoint, or command without collecting secrets or customer data.
2. Check the worktree, recent relevant changes, and applicable project guidance. Separate the requested scope from unrelated local modifications.
3. Trace the behavior through the relevant callers and contracts. In TaxFlow, check UI-to-API behavior, Express validation and response handling, Supabase versus demo mode, and metadata versus private document storage as applicable.
4. Inspect likely boundary conditions: missing or malformed fields, empty results, authorization/ownership, retry and cleanup paths, async failures, date/time and money calculations, and untrusted OCR/extracted data.
5. Reproduce with the smallest safe local test or fixture. Use existing checks first; do not mutate production data or call live external services just to prove a theory. If the issue is intermittent or cannot be reproduced, report that accurately.
6. Identify and verify the root cause. Check whether a shared helper or caller already handles the case; avoid symptom-only explanations and duplicate findings.
7. Report exact file/line evidence, trigger, impact, reproduction or verification performed, confidence, and any remaining unknowns. If the user asked for a fix, make the smallest root-cause change and run the focused check.

## Output

```text
Issue:
Expected:
Actual:
Root cause:
Evidence / reproduction:
Impact:
Confidence: 1-10
Verification:
Unknowns:
```

Do not claim a root cause when evidence only shows correlation. State clearly when no bug was confirmed and what remains unverified.

## Source

TaxFlow-specific workflow informed by the MIT-licensed systematic debugging skill in [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging). That repository had about 315,400 stars when checked on 2026-11-10; stars are a repository-level signal, not a skill rating.
