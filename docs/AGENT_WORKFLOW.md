# Agent Workflow — pet-tamagotchi

Standard process for taking a GitHub issue from backlog to merged PR.

---

## Steps

### 1. Pick issue
Choose highest-priority open issue. Note the issue number, title, and which layer it affects (on-chain / frontend / both).

### 2. Create feature branch
```bash
git checkout development
rtk git pull origin development
git checkout -b feat/issue-<N>-<short-slug>
```

### 3. Plan with feature-planner
Invoke the `feature-planner` agent. Give it:
- Issue title + body
- Affected roadmap milestone (R1, R2, …)
- Any pre-existing concerns from `docs/AGENT_CREATION.md`

Agent outputs: **Goal**, instruction signatures, account layouts, PDA seeds, events, error codes, test matrix, open questions.  
Resolve open questions before proceeding.

### 4. Implement
Route to worker agents based on what's changing:

| Scope | Agents |
|---|---|
| On-chain only | `solana-builder` |
| Frontend/client only | `frontend-builder` |
| Both | `solana-builder` first, then `solana-tester` + `frontend-builder` in parallel |

Each agent receives the `feature-planner` output as context.

`solana-builder` done condition: `anchor build` green + `target/idl/pet_tamagotchi.json` and `target/types/pet_tamagotchi.ts` committed.

### 5. Test
After `solana-builder` finishes, invoke `solana-tester` (can run in parallel with `frontend-builder`).

`solana-tester` scope:
- Stat delta assertions
- Time-warp tests via bankrun `setClock`
- Happy paths and documented error codes
- Edge cases flagged in `feature-planner` test matrix

### 6. Security audit with security-auditor
Invoke `security-auditor` on every PR. It reads `programs/` (read-only) and produces structured findings:

```
(finding, severity, file:line, suggested fix)
```

Severity guide:
- **P0/P1** — block merge. Loop back to `solana-builder` (max 2 loops), then re-audit.
- **P2/P3** — document in PR body. Merge allowed.

### 7. Open PR with commit-with-issue
Invoke `commit-with-issue`. It will:
- Verify branch is not `master` or `development`
- Target `development` (feature → development) or `master` (development → master)
- Derive title + body from `git log` and `git diff`
- Close the GitHub issue automatically via `Closes #N` in commit/PR body
- Push branch and open PR via `gh pr create`

---

## Spawn Pattern

```
feature-planner
  └─► solana-builder              (Rust + anchor build + IDL commit)
        ├─► solana-tester          (parallel — bankrun tests)
        └─► frontend-builder       (parallel — client + React UI)
              └─► security-auditor (always — every PR)
                    └─► solana-builder  (only if P0/P1, max 2 loops)
```

---

## Agent Map

| Agent | When to use |
|---|---|
| `feature-planner` | Step 3 — always |
| `solana-builder` | Step 4 — on-chain changes |
| `solana-tester` | Step 5 — after solana-builder |
| `frontend-builder` | Step 4/5 — frontend/client changes |
| `security-auditor` | Step 6 — every PR |
| `commit-with-issue` | Step 7 — always |

Future agents (activate at the milestone noted):

| Agent | Milestone |
|---|---|
| `spl-integrator` | R2 — SPL token payments |
| `migration-planner` | R7 — account realloc / versioning |
| `indexer` | R6 — Helius webhooks + Postgres |

---

## Branch Naming

```
feat/issue-<N>-<short-slug>    # new feature or improvement
fix/issue-<N>-<short-slug>     # bug fix
chore/issue-<N>-<short-slug>   # cleanup, tooling, docs
```

---

## Merge Flow

```
feature branch  →  development  →  master
```

- Feature PRs always target `development`.
- `development → master` PRs are cut after milestone stabilizes (not per-feature).

---

## Example

```
Issue #12 — R1 Item Shop: init_inventory instruction

1. git checkout -b feat/issue-12-item-shop
2. feature-planner  → spec: Inventory account, buy_item, use_item, events, errors
3. solana-builder   → implement lib.rs, anchor build, commit IDL
4. solana-tester    → bankrun tests: buy flow, use_item stat deltas, InsufficientFunds error
   frontend-builder → extend petClient.ts + React shop UI  (parallel with tester)
5. security-auditor → verify security checklist from AGENT_CREATION.md
6. commit-with-issue → PR to development, Closes #12
```
