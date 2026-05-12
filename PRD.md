# KleverOne Planning Agent — PRD (Sprint 1)

**Status:** Draft v1
**Owner:** TBD
**Last updated:** 2026-05-12
**Source:** `submission-v2.pdf`, `context.txt`

---

## 1. Summary

KleverOne's Planning Agent produces a **first-draft media plan** a Strategist will actually use, with **SSP-direct as the default** and **DSP as the justified exception**. Sprint 1 ships the thin end-to-end slice that validates the thesis plus the regression suite that protects it from week-two prompt regressions.

## 2. Problem

Klever is moving from a DSP-default architecture (TTD, DV360, Amazon DSP) to an ad-server-as-source-of-truth model where SSP-direct (PubMatic, Equativ, Magnite) is the default, AdCP/publisher-direct handles premium, and DSPs must earn their seat. Strategists today:

- Build plans from scratch in slides.
- Default to DSP thinking — the habit Klever is explicitly trying to break.
- Have no shared mechanism for defending a DSP line to a client or to AdOps.

Without a tool that **makes SSP-direct-first reasoning visible and defensible**, the architecture shift is policy, not practice.

## 3. Goals

- A Strategist can paste a brief and get a usable first-draft plan in one session.
- Every DSP line in the plan carries a written, defensible justification.
- DSP-default creep is detectable in CI before a prompt change reaches a Strategist.
- Plans are inline-editable, exportable to AdOps (CSV) and to slides/notion (markdown).

### Non-goals (Sprint 1)

- Writing plans to GAM or any ad server.
- Live SSP/DSP MCP calls during generation — use a daily-refreshed deal snapshot.
- Full AdCP integration — stub as named placeholders.
- Catalog admin UI — catalog lives as JSON in repo, updated via PR.
- Brand polish, history sidebar, sharing beyond per-user URLs.
- Model-confidence-based "needs review" flagging on extracted fields.

## 4. Users

- **Primary: Account Strategist** — programmatic-fluent, non-technical. Scopes/plans campaigns. Will not write prompts or edit JSON.
- **Secondary: AdOps Trader** — receives the plan as CSV for trafficking.
- **Internal: Planning team / AI engineer** — owns prompt, catalog, and eval suite.

## 5. Scope

### In scope (2-week sprint)

| Capability | Notes |
|---|---|
| Brief intake + confirmation | 11-field structured extraction, inline-editable, edit telemetry |
| Plan generation | Deterministic DSP gate + LLM rationale + LLM allocation reasoning |
| Structured output | Required `dsp_justification` on every DSP line |
| Inline editing | Spend %, rationale, allocation rationale; totals recalculate |
| Exports | CSV (stable column order for AdOps), markdown copy |
| Persistence | Per-user plans on Vercel Postgres; stable URL |
| Auth | Vercel-protected route + email allowlist |
| Observability | Sentry, prompt versioning, full call logs |
| Regression suite | ≥15 golden briefs, deterministic checks, LLM-judge rubric, CI |

### Out of scope / deferred

Live MCP calls during generation, AdCP integration, GAM line export, catalog admin UI, brand polish, history sidebar / shared URLs, low-confidence field flagging.

## 6. User stories & acceptance criteria

### Story 1 — Brief intake and confirmation
> As a Strategist, I paste a brief in plain language and confirm what the agent extracted before it drafts the plan.

- Free text → structured extraction within **60s**.
- Confirmation surfaces the 11 fields: **advertiser, vertical, budget, flight, KPI, goal, geo, audience, inventory, exclusions, channels**.
- All fields inline-editable; edits captured as structured events.
- Low-confidence extractions marked "needs review" and must be confirmed before Generate. *(Deferred to post-v1 if extractor cannot emit confidence cleanly — see §3 non-goals.)*

### Story 2 — SSP-direct-first plan, defended DSP gate
> As a Strategist, I get a draft plan where SSP-direct is the default and any DSP line carries a justification I can defend to a client.

- Briefs without DSP-eligible signals yield **zero** DSP lines.
- Every DSP line carries a justification covering: what's unique, what SSP/AdCP cannot do, why this share.
- Plan-level **DSP gate summary**: considered, earned, rejected with reasons.
- All `capability_id` and `deal_ref` values resolve against the catalog/snapshot; hallucinations fail generation.
- Line shares sum to 100% of budget.

### Story 3 — Allocation reasoning that defends itself
> As a Strategist, every line tells me why it got the share it did; editing a DSP line above its ceiling surfaces the original reasoning inline.

- Every line has an `allocation_rationale` **distinct from** `rationale`.
- Allocation rationale names: the share, the brief constraint driving it, a trade-off vs an alternative share.
- DSP lines carry a `share_ceiling` + reason.
- Editing above the ceiling surfaces the original reason **in the row** (not tooltip-only).

### Story 4 — Edit, capture, hand off
> As a Strategist, I edit the plan inline, edits become structured feedback, and I can hand off to AdOps in a usable format.

- Spend %, rationale, allocation rationale all inline-editable; totals recalculate.
- "N edits captured" indicator whenever the plan diverges from the original.
- **CSV export** with stable column order for AdOps trafficking.
- **Markdown copy** for Slides/Notion paste.
- Plans persist per user via stable URL.

### Story 5 — Regression-protected DSP default (team story)
> As the planning team, we detect DSP-default creep before a prompt change or model swap reaches a Strategist.

- Regression set of **≥15 briefs** covering: pure-SSP, YouTube-in-scope, retargeting-performance, retail-performance, underspecified-edge.
- Suite runs on every prompt/model change in CI; results versioned.
- **Hard gates** (block deploy):
  - Schema validation 100%.
  - Zero `capability_id` / `deal_ref` hallucinations.
  - DSP share ≤15% on pure-SSP briefs.
  - Every DSP line carries a non-empty justification.
- **Soft gates** (LLM-judged vs reference plans): rationale, allocation, and justification quality — regressions reviewed before merge.

## 7. Functional requirements

### Plan-output schema (locked surface for v1)

Every plan contains:
- `lines[]` with `channel`, `path` (`ssp_direct` | `adcp` | `dsp`), `capability_id[]`, `deal_ref[]`, `spend_share`, `rationale`, `allocation_rationale`.
- DSP lines additionally require: `dsp_justification`, `share_ceiling`, `share_ceiling_reason`.
- Plan-level: `dsp_gate_summary` { considered, earned, rejected[] with reason }.
- Schema must remain translatable to GAM insertion-order / line-item shape (see open question 3).

### Deterministic DSP gate (pre-LLM)

A rules layer decides DSP-eligibility from extracted brief signals (YouTube-in-scope, retargeting, performance KPI, etc.) **before** generation. The LLM cannot introduce a DSP line unless the gate has marked it earned; if it tries, the structured-output validator rejects the plan.

### Catalog & deal snapshot

- Capabilities catalog: JSON in repo, PR-flow updates.
- Deal snapshot: daily-refreshed JSON dump from SSPs; treated as the resolvable universe for `deal_ref`.

## 8. Success metrics

- **Adoption:** ≥1 Strategist uses the agent on a real brief by end of sprint 1.
- **Trust:** ≥70% of generated plans accepted with ≤3 edits in pilot week (proxy via edit telemetry).
- **Cultural mechanic holds:** DSP share on pure-SSP regression briefs stays ≤15% across the first 4 prompt iterations post-launch.
- **Hand-off:** AdOps can traffic from the CSV without re-keying.

## 9. Constraints & assumptions

- Team: 1 full-stack + 1 AI engineer.
- Strategists will not write prompts or edit JSON.
- API/MCP access to required DSPs and SSPs exists, but not used live in v1.
- Deploy target: Vercel + Vercel Postgres.

## 10. Dependencies

- Capabilities catalog content (owner TBD — see open question 2).
- Golden-brief set + judge rubric signed off by a named Strategist (~4 hrs/week — see open question 1).
- GAM (or equivalent) line-item shape reference for schema translation (see open question 3).

## 11. Open questions (blocking)

1. **Who is the named authority on "this is a good plan"?** Eval suite and LLM-judge prompts must calibrate against one human. Need one committed Strategist or planning lead at ~4 hrs/week through sprint 1.
2. **Is the capabilities catalog fit for purpose, and who owns it?** Need every entry's description, channels, KPIs, limitations confirmed accurate and current before locking the prompt and the eval. Cleanup work, if needed, is outside the two-engineer scope.
3. **What does "ad-server source of truth" mean concretely for the plan-output schema?** v1 doesn't write to GAM, but the plan schema must remain translatable to its insertion-order / line-item shape — otherwise the buying agent inherits a translation layer that didn't have to exist. Shape needed before schema lock.

## 12. Rollout

- Internal-only behind email allowlist on Vercel.
- Sentry on; full prompt + completion logs retained.
- Prompt versioning live from day 1; every plan record stores prompt version.
- CI regression suite gates every prompt/model PR before merge.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Prompt regresses to DSP-default after a tweak | Regression suite with hard gates in CI (Story 5) |
| LLM hallucinates `capability_id` / `deal_ref` | Structured-output validator fails generation on unresolved refs |
| Strategists distrust output, revert to slides | Inline-editable plan + visible allocation rationale + edit telemetry to close the loop |
| Schema needs to change once GAM shape lands | Treat schema as v1; reserve a v2 migration; keep export layer thin |
