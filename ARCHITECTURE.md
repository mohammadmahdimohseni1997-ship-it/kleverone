# KleverOne Planning Agent — Architecture (Sprint 1)

**Status:** Draft for engineering hand-off
**Audience:** 1 full-stack engineer + 1 AI engineer + PO
**Last updated:** 2026-05-12
**Source consultations:** solution-architect, ai-engineer, fullstack-engineer, ux-designer, ui-designer, qa-engineer, product-manager
**Companion docs:** `PRD.md`, `submission-v2.pdf`, `context.txt`

---

## 0. Executive Summary

A Next.js 16 App Router on Vercel, fronting a deterministic-first AI pipeline (Anthropic Claude Sonnet 4.6 + Haiku 4.5), persisting plans, briefs, edits, and a full model-call log to Vercel Postgres. The product's cultural job — make SSP-direct the default and DSP the defended exception — is enforced by **three reinforcing layers**:

1. A **deterministic DSP gate** before any LLM call decides which (if any) DSP vendors are even eligible.
2. A **structured output contract** that makes `dsp_justification` mandatory on every DSP line and capability/deal references non-hallucinable.
3. A **regression harness in CI** with hard gates on schema, hallucination, DSP share, and justification — running on every prompt or model PR.

The frontend renders the plan as a dense, scannable table where DSP lines carry a dedicated always-visible justification column (the cultural mechanic must survive a screenshot, which row tints don't). Edits are inline, optimistic, captured as structured telemetry — the highest-fidelity feedback the platform will ever get.

Sprint 1 deliberately defers live MCP calls, AdCP integration, GAM export, and SSO. What ships is end-to-end and protected.

---

## 1. System Diagram

```
                                            ┌──────────────────────────────┐
                                            │  Capabilities Catalog        │
                                            │  /src/data/catalog/*.json    │
                                            │  (in repo, PR-flow updates)  │
                                            └─────────────┬────────────────┘
                                                          │ imported at build
                                                          ▼
┌──────────────┐    POST /api/extract    ┌────────────────────────────────────────┐
│  Next.js     │ ──────────────────────► │  Route Handlers (Node runtime)         │
│  App Router  │                         │  ┌────────────────────────────────┐    │
│  (RSC + CSR) │ ◄── streaming SSE ───── │  │ AI Pipeline                    │    │
│              │    POST /api/plans/gen  │  │ 1 extract  → Brief             │    │
│              │                         │  │ 2 dsp-gate → DspAssessment     │    │
│              │ ──── Server Actions ──► │  │ 3 retrieve → CapabilityIds[]   │ ◄──┼──── catalog (in-process)
│              │  updateLine, exportCsv  │  │ 4 generate → Plan (LLM stream) │    │
│              │  listMyPlans, getPlan   │  │ 5 validate → ValidationResult  │    │
└──────┬───────┘                         │  └─────────┬──────────────────────┘    │
       │                                 │            │                            │
       │ session cookie (Auth.js v5)     │            ▼                            │
       │                                 │   ┌────────────────────┐                │
       │                                 │   │ Anthropic Claude   │                │
       │                                 │   │ Sonnet 4.6 / Haiku │                │
       │                                 │   │ 4.5 (cached system)│                │
       │                                 │   └────────────────────┘                │
       │                                 │            │                            │
       │                                 │            ▼                            │
       │                                 │   ┌────────────────────┐                │
       │                                 │   │ Vercel Postgres    │                │
       │                                 │   │ users, briefs,     │                │
       │                                 │   │ plans, plan_lines, │                │
       │                                 │   │ plan_edits,        │                │
       │                                 │   │ model_calls,       │                │
       │                                 │   │ prompt_versions    │                │
       │                                 │   └────────────────────┘                │
       │                                 │                                         │
       │                                 │   ┌────────────────────┐                │
       │                                 │   │ Deal snapshot      │ ◄─ Vercel cron │
       │                                 │   │ Vercel Blob JSON   │    daily 06:00 │
       │                                 │   │ deals-YYYY-MM-DD   │    America/    │
       │                                 │   └────────────────────┘    Toronto     │
       │                                 └────────────────────────────────────────┘
       ▼
  Sentry (errors)  ◄─── all server code via @sentry/nextjs
```

**Happy path:** brief text → `/api/extract` (Sonnet, 1–2s) → editable `Brief` → user confirms → `/api/plans/generate` streams `DspAssessment` then plan lines (Sonnet, 10–18s) → post-validation → persist → client renders streamed plan and enters edit mode where each edit fires a Server Action writing to `plan_edits`.

---

## 2. Architecture Principles (read before designing anything)

1. **Deterministic before LLM.** Anything reducible to a filter, a rule, or a lookup is deterministic. Burning LLM tokens on closed-form problems imports non-determinism, latency, and cost for no recall gain.
2. **Structured output is the contract.** The plan schema is the single source of truth shared between AI engineer, full-stack engineer, and QA. Locked in week one; every diff after pays rework.
3. **Audit everything once.** Every plan reconstructible from its `brief_snapshot`, `prompt_version_id`, `catalog_version`, and `deal_snapshot_date`. Half a day in v1; impossible to retrofit cleanly in v3.
4. **Plan edits are signal.** Inline cell edit, optimistic, structured event per change. If editing is painful the team gets no feedback signal — and the cultural mechanic regresses without anyone noticing.
5. **DSP visibility is a UI requirement, not a model requirement.** A model that "picked the right answer" is wasted if the UI buries the `dsp_justification`. The dedicated justification column is the cultural mechanic's last mile.
6. **Sprint 1 ships the eval with the product.** The regression suite is not sprint-2 polish; without it the cultural mechanic regresses on the first prompt tweak.

---

# PART A — BACKEND & AI PIPELINE

## 3. AI Pipeline (5 Stages)

Single in-process composition inside `/src/lib/pipeline/`. No queue, no worker — Vercel function timeout on Pro is 300s, well above the 30s budget. Anthropic SDK only (`@anthropic-ai/sdk` ^0.40) with prompt-caching beta header if not GA by build time.

| Stage | Input | Output | Deterministic vs LLM | Model | Cache scope | Latency budget | Failure handling |
|---|---|---|---|---|---|---|---|
| 1. Extraction | Free-text brief (≤4k chars) | `Brief` (11 fields, strict schema) | LLM, tool-use forced | `claude-sonnet-4-6` | system prompt + field schema (≈800 tokens) | **2.0s p95** | Schema fail → 1 retry with validator errors injected. Second pass fails → return partial `Brief` with `_unknown` flags; Strategist confirms before generate. |
| 2. DSP gate | `Brief` | `DspAssessment { eligible[], rejected[], summary }` | **Deterministic** (pure TS rules; port `assessDspGate` from mock) | none | n/a | **<5ms** | Cannot fail; rules are total over the brief domain. Logged for audit. |
| 3. Retrieval | `Brief` + `DspAssessment.eligible[].vendor` | `Capability[]` filtered subset (typically 8–20 of ≈15–200) | **Deterministic** filter on `channels ∩ brief.channelsInScope`, `kpis ∋ brief.kpi`, vendor-type allowed by gate | none | n/a | **<10ms** | Empty subset → pipeline aborts before LLM call with `RETRIEVAL_EMPTY` rendered to UI. |
| 4. Plan generation | `Brief`, `DspAssessment`, retrieved `Capability[]`, deal snapshot subset | `Plan` (streamed via tool-use partial JSON) | LLM, tool-use forced, single tool `emit_plan` | `claude-sonnet-4-6` | system prompt + full catalog (≈8–12k tokens) | **12–18s p95**, first token ≤5s | Validation failure → 1 retry with errors injected. Second failure → `VALIDATION_FAILED` with raw model output to debug viewer. |
| 5. Post-validation | `Plan` | `ValidationResult` | **Deterministic** | none | n/a | **<50ms** | See stage 4. On success, write Plan + lines + ModelCall row in single Postgres transaction. |

**Total latency target:** under 25s p95, first plan line visible under 6s.

### Stage-2 rules (deterministic DSP gate)

The gate is the cultural mechanic's load-bearing surface. It produces a structured `DspAssessment`:

- **DV360 eligible iff** `brief.channelsInScope` includes `"youtube"`. Reason: YouTube walled-garden inventory.
- **TTD eligible iff** brief has a retargeting-pool signal (`audience` references "retargeting"/"retarget"/"site visitors"/"cart abandoners") **OR** `kpi ∈ {CPA, CTR}` AND `goal === "performance"`.
- **Amazon DSP eligible iff** `vertical ∈ retail-endemic-list` AND `kpi ∈ {CPA, CTR}`.
- Otherwise all DSPs rejected; reasons attached per vendor.
- Each eligible vendor carries `share_ceiling` (DV360 25%, TTD 35%, Amazon DSP 35%) and `share_ceiling_reason`.

The LLM cannot introduce a DSP line absent from the gate's `eligible[]`; the structured-output validator rejects.

### Why these choices

- **Sonnet 4.6, not Opus, for generation:** the cultural job is enforced by the gate + schema, not by reasoning depth. Opus is ~5× cost for marginal quality. Promote only if eval shows Sonnet regressing on rationale judges.
- **Structured filter, not vector search for stage 3:** catalog is closed-vocabulary, ≤200 entries, with explicit `channels` and `kpis` arrays. Embeddings add a model dependency and an index store for zero recall gain. Defend in PR review.
- **Haiku 4.5 held in reserve.** The only obvious Haiku target (a "needs review" confidence classifier) is explicitly deferred per PRD §3.
- **Prompt caching:** system prompt + full catalog in one `cache_control: { type: 'ephemeral' }` block. Expected ~85% hit rate within a session. Moves per-call cost from ~$0.06 to ~$0.02 once warm.

---

## 4. Data Layer

### 4.1 Postgres tables (Vercel Postgres, schema `app`)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE NOT NULL,
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE app.prompt_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage           text NOT NULL CHECK (stage IN ('extract','generate')),
  semver          text NOT NULL,
  git_sha         text NOT NULL,
  prompt_hash     text NOT NULL,
  model_id        text NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage, semver)
);

CREATE TABLE app.briefs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app.users(id),
  raw_text        text NOT NULL,
  extracted       jsonb NOT NULL,
  extract_prompt_version_id uuid NOT NULL REFERENCES app.prompt_versions(id),
  edits           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app.users(id),
  brief_id        uuid NOT NULL REFERENCES app.briefs(id),
  brief_snapshot  jsonb NOT NULL,
  dsp_assessment  jsonb NOT NULL,
  total_budget    integer NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  generate_prompt_version_id uuid NOT NULL REFERENCES app.prompt_versions(id),
  catalog_version text NOT NULL,
  deal_snapshot_date date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','exported','archived'))
);
CREATE INDEX plans_user_id_generated_at_idx ON app.plans(user_id, generated_at DESC);

CREATE TABLE app.plan_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES app.plans(id) ON DELETE CASCADE,
  ordinal         integer NOT NULL,
  vendor          text NOT NULL,
  vendor_type     text NOT NULL CHECK (vendor_type IN ('SSP','DSP','AdCP')),
  channel         text NOT NULL,
  path            text NOT NULL CHECK (path IN ('ssp_direct','adcp','dsp')),
  spend_pct       numeric(5,2) NOT NULL,
  spend_dollars   integer NOT NULL,
  deal_refs       text[] NOT NULL DEFAULT '{}',
  capability_ids  text[] NOT NULL DEFAULT '{}',
  rationale       text NOT NULL,
  allocation_rationale text NOT NULL,
  dsp_justification text,
  share_ceiling   numeric(5,2),
  share_ceiling_reason text,
  CONSTRAINT dsp_fields CHECK (
    (vendor_type = 'DSP'  AND dsp_justification IS NOT NULL AND share_ceiling IS NOT NULL)
    OR (vendor_type <> 'DSP' AND dsp_justification IS NULL AND share_ceiling IS NULL)
  )
);
CREATE INDEX plan_lines_plan_id_ordinal_idx ON app.plan_lines(plan_id, ordinal);

CREATE TABLE app.plan_edits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES app.plans(id) ON DELETE CASCADE,
  line_id         uuid REFERENCES app.plan_lines(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app.users(id),
  field           text NOT NULL,
  old_value       jsonb NOT NULL,
  new_value       jsonb NOT NULL,
  edited_at       timestamptz NOT NULL DEFAULT now(),
  exceeds_ceiling boolean NOT NULL DEFAULT false
);
CREATE INDEX plan_edits_plan_id_edited_at_idx ON app.plan_edits(plan_id, edited_at);

CREATE TABLE app.model_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES app.users(id),
  plan_id         uuid REFERENCES app.plans(id) ON DELETE SET NULL,
  brief_id        uuid REFERENCES app.briefs(id) ON DELETE SET NULL,
  stage           text NOT NULL,
  prompt_version_id uuid NOT NULL REFERENCES app.prompt_versions(id),
  model_id        text NOT NULL,
  request         jsonb NOT NULL,
  response        jsonb NOT NULL,
  input_tokens    integer NOT NULL,
  output_tokens   integer NOT NULL,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd        numeric(10,6) NOT NULL,
  latency_ms      integer NOT NULL,
  validation_ok   boolean,
  validation_errors jsonb,
  retry_of_id     uuid REFERENCES app.model_calls(id),
  is_eval_run     boolean NOT NULL DEFAULT false,
  run_id          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_calls_plan_id_idx ON app.model_calls(plan_id);
CREATE INDEX model_calls_created_at_idx ON app.model_calls(created_at DESC);
CREATE INDEX model_calls_eval_run_idx ON app.model_calls(is_eval_run, run_id);
```

**Audit trail columns** (must survive a "reconstruct what happened" query): `briefs.raw_text`, `briefs.extracted`, `briefs.extract_prompt_version_id`, `plans.brief_snapshot`, `plans.dsp_assessment`, `plans.generate_prompt_version_id`, `plans.catalog_version`, `plans.deal_snapshot_date`, all of `plan_edits`, all of `model_calls`.

**`brief_snapshot` is intentionally denormalized onto `plans`.** A user editing their brief after generation must not mutate the plan's input record. Provide a Drizzle helper `getPlanInputBrief(planId)` that reads `brief_snapshot` only; ban direct `plans → briefs` joins for input reads in PR review.

ORM: **Drizzle** (Vercel Postgres has first-class support, types align with TS contracts).

### 4.2 Capabilities catalog

- **Location:** `/src/data/catalog/capabilities.json`.
- **Schema:** the `Capability` type from `types.ts`.
- **Update flow:** PR to `main`. Required reviewer: catalog owner (PRD open question #2 — must be named before sprint end). CI validates shape + runs the regression suite. Merge triggers redeploy; `plans.catalog_version = git sha`.
- **Cutover trigger to a live store:** first time a Strategist reports the agent citing a stale capability in production, **or** a second capability change ships in any 7-day window. Either signal means PR-flow is the bottleneck; promote to Airtable or Notion-as-DB with a 5-min server-side cache. Don't pre-build.

### 4.3 Deal snapshot

- **Format:** `{ snapshotDate: 'YYYY-MM-DD', deals: { [vendor]: DealRef[] } }`.
- **Storage:** Vercel Blob, key `deal-snapshots/YYYY-MM-DD.json`. Public-read (deal IDs not secret), authed writes.
- **Refresh:** Vercel Cron `0 10 * * *` UTC (06:00 America/Toronto), invokes `/api/cron/refresh-deals`. Sprint 1 reads a seed `/src/data/deal-snapshot-seed.json` and writes it with today's date — the cron exists so wiring is real; replacing the body with live SSP MCP calls is sprint 2+.
- **Naming:** `planning-deal-snapshot-*` (not `deal-snapshot-*`) so the buying agent's freshness requirement is an explicit handoff problem, not an implicit downgrade.

---

## 5. API Surface

Convention: **Server Actions** for mutations triggered by a form/button where streaming isn't needed; **Route Handlers** for streaming responses, cron, and anything outside RSC. Matches Next.js 16's documented split (verified in `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` and `15-route-handlers.md`).

| Surface | Kind | Method/path | Request | Response | Streaming |
|---|---|---|---|---|---|
| Extract brief | Route Handler | `POST /api/extract` | `{ rawText: string }` | `{ brief: Brief, briefId: uuid }` | No |
| Generate plan | Route Handler | `POST /api/plans/generate` | `{ briefId: uuid, brief: Brief }` | SSE: `event: dsp_assessment`, `event: line` (one per line), `event: validation`, `event: plan` | **Yes** |
| Update plan line | Server Action | `updatePlanLine(planId, lineId, patch)` | `{ spendPct?, rationale?, allocationRationale? }` | `{ plan, edits }` | No |
| Export CSV | Route Handler | `GET /api/plans/:id/export.csv` | path | `text/csv` (locked column order) | No |
| Export markdown | Server Action | `exportPlanMarkdown(planId)` | `{ planId }` | `{ markdown: string }` for clipboard copy | No |
| List my plans | Server Action | `listMyPlans()` | none (session) | `PlanSummary[]` | No |
| Get plan | Server Action | `getPlan(planId)` | `{ planId }` | `{ plan, edits }` | No |
| Cron: refresh deals | Route Handler | `GET /api/cron/refresh-deals` | Vercel Cron header | `{ snapshotDate }` | No |

**CSV column order (locked for AdOps):** `ordinal, vendor, vendor_type, path, channel, spend_pct, spend_dollars, deal_refs, capability_ids, rationale, allocation_rationale, dsp_justification, share_ceiling, share_ceiling_reason`. Locked because AdOps will write a sheet or macro against it; reordering after sprint 1 is a breaking change.

**Streaming strategy:** Anthropic SDK's `messages.stream()` with `tool_use` produces partial JSON for the `emit_plan` tool. Server parses streamed JSON incrementally (`partial-json` package, ~3kb) and emits a discrete SSE event per fully-formed plan line. Final `event: plan` after post-validation; on validation failure the retry happens server-side before any retry event is emitted.

**Auth on both surfaces:** Next.js 16 docs warn Server Functions are reachable by direct POST. Both surfaces call `await requireUser()` at the top — implement once in `/src/lib/auth/session.ts`.

---

# PART B — FRONTEND ARCHITECTURE

## 6. Route Map (Next.js App Router)

```
app/
  layout.tsx                          [server]  AuthShell, fonts, Sentry init
  page.tsx                            [server]  redirect → /plans
  plans/
    layout.tsx                        [server]  authed shell, nav, user chip
    page.tsx                          [server]  list — server-fetched
    new/
      page.tsx                        [server]  brief intake, hosts <BriefInput/>
    [id]/
      page.tsx                        [server]  fetch plan + brief, mount <PlanWorkspace/>
      not-found.tsx                   [server]
      error.tsx                       [client]  segment error boundary
      loading.tsx                     [server]  skeleton shell
  api/
    plans/[id]/stream/route.ts        [server]  GET, streams plan
  actions/
    plans.ts                          [server]  create, updateBrief, patchLine, logEdit, exportCsv
```

**Routing decisions:**

- **`/plans` is a route, not a dropdown.** Strategists will return to past plans; sidebar is sprint-2 polish.
- **`/plans/new` is a route.** Back button works; refresh doesn't nuke a paste.
- **`/plans/[id]` carries the whole workspace** — confirmation banner + table + assessment + export. Confirmation is an **inline section** above the table, not a separate route. Collapsing it inline keeps the plan visible while edits refresh the source-of-truth banner.
- **No `/plans/[id]/edit`.** Edit is inline on the plan view; separating it would regress the edit-as-feedback primitive.
- **API route only for streaming.** Vercel AI SDK requires a Route Handler; everything else through Server Actions for free CSRF + auth.

---

## 7. Component Tree

```
<AuthShell>                                            (server)
  <SiteHeader/>                                        (server)  KleverOne mark, user chip, "New plan" CTA
  <main>
    /plans                → <PlansList/>               (server)
    /plans/new            → <BriefInput/>              (client)
    /plans/[id]           → <PlanWorkspace/>           (client)
        <PlanWorkspaceHeader/>                         (client)
        <ExtractedBriefConfirmation/>                  (client)
        <DspGateSummary/>                              (client)
        <EditsCapturedIndicator/>                      (client)
        <PlanTable/>                                   (client)
            <PlanLineRow/> × N                         (client)
            <StreamingSkeletonRow/> × (expected − N)   (client)
            <PlanTableFooter/>                         (client)
        <ValidationIssues/>                            (client)
  <Toaster/>                                           (client)  shadcn sonner
```

### Component specs

| Component | Path | S/C | Owns |
|---|---|---|---|
| `AuthShell` | `src/components/shell/AuthShell.tsx` | server | Vercel auth gate; allowlist redirect |
| `BriefInput` | `src/components/brief/BriefInput.tsx` | client | textarea, "Use example", submit |
| `ExtractedBriefConfirmation` | `src/components/brief/ExtractedBriefConfirmation.tsx` | client | 11-field form (`react-hook-form` + zod), edit capture per field |
| `PlanWorkspace` | `src/components/plan/PlanWorkspace.tsx` | client | URL→state hydration, edit count diff, stream subscription |
| `DspGateSummary` | `src/components/plan/DspGateSummary.tsx` | client | one-line summary, expand-to-read rejected reasons |
| `EditsCapturedIndicator` | `src/components/plan/EditsCapturedIndicator.tsx` | client | count pill |
| `PlanTable` | `src/components/plan/PlanTable.tsx` | client | colgroup, header, footer, row iteration |
| `PlanLineRow` | `src/components/plan/PlanLineRow.tsx` | client | one `<tr>`, ceiling warning, edit acks |
| `StreamingSkeletonRow` | `src/components/plan/StreamingSkeletonRow.tsx` | client | 10 skeleton `<td>`s |
| `ExportMenu` | `src/components/plan/ExportMenu.tsx` | client | shadcn `<DropdownMenu>` → Export CSV, Copy markdown |
| `ErrorBoundary` | `src/app/plans/[id]/error.tsx` | client | recoverable error UI |

```ts
// src/components/plan/PlanTable.tsx — prop type
export type PlanTableProps = {
  plan: Plan;
  originalLines: PlanLine[];      // for edit-diff highlighting
  assessment: DspAssessment;
  streaming: boolean;
  expectedLineCount: number;
  onLineChange: (lineId: string, patch: Partial<PlanLine>) => void;
};
```

---

## 8. The DSP-Line Visual Treatment Decision

**Decision: dedicated always-visible justification column, populated and prominently styled only on DSP lines.**

**Defense vs row-tint / left-border:** row tint requires the eye to learn "this color = read column X"; a screenshot pasted into a slide deck without the legend strips that signal. The cultural-mechanic survival rule says the justification must travel with the row — color does not.

**Defense vs vendor-cell badge with inline-truncated justification:** collapsing the justification into the vendor cell forces a tooltip or expand to read it — exactly the "buried in expand-to-read" failure mode. AdOps pasting into Sheets loses the badge styling.

The dedicated column also makes absence of justification on SSP/AdCP lines an em-dash — silent — which is the right visual default. DSP rows additionally get a 2px **left border on the justification cell only** in functional amber (Tailwind `border-amber-500`); this rule survives screenshot, accessibility (paired with text, not color-only), and is implementable in shadcn's table primitives in under an hour.

---

## 9. Table Design

### Columns

| # | Column | Align | Type | Max width | Truncation |
|---|---|---|---|---|---|
| 1 | Vendor | left | prose, semibold | 120px | none |
| 2 | Type | left | badge | 64px | n/a |
| 3 | Channel | left | prose | 88px | none |
| 4 | Spend % | **right** | tabular num, editable | 96px | n/a |
| 5 | Spend $ | **right** | tabular num, computed | 112px | n/a |
| 6 | Deal / PMP | left | mono, stacked chips | 168px | wrap |
| 7 | Capabilities | left | prose list, stacked | 168px | name only; full on `title` |
| 8 | Rationale | left | prose, editable | 240px | `line-clamp-2`, expand |
| 9 | Allocation rationale | left | prose, editable | 220px | `line-clamp-2`, expand |
| 10 | DSP justification | left | prose | 260px | `line-clamp-3`, expand (read-only) |

**Total table width ~1356px.** Fits 1280px with light horizontal scroll; breathes at 1440px+. Acceptable.

### Type stack
- `font-sans`: Inter Variable (via `next/font/google`).
- `font-mono`: JetBrains Mono Variable (capability/deal IDs).
- Numeric: Inter with Tailwind `tabular-nums`.

### Edit affordances
- **Editable cells (Spend %, Rationale, Allocation):** dotted underline at rest, solid on hover (cursor-text), solid 1px border + inline textarea on focus. Post-edit: solid underline + `font-medium` weight permanently — row diverges visibly from original.
- **Non-editable cells:** no underline, no cursor change.
- **Saved tick:** the workspace-level `EditsCapturedIndicator` pill is the global ack. Per-row ticks add noise.

### Density
**8–10 lines visible on 1080p without scroll.** Row 56–64px. Header 36px, footer 36px, page chrome ~140px → 904px available → 14 rows at 64px. Comfortable for typical 6–8 line plans.

### Screenshot survival
The table must look intentional cropped to cols 1–5 (vendor through spend $) and cols 1, 2, 10 (vendor, type, DSP justification) — the two screenshots a Strategist will paste into a deck. No row-level tints, no decorative gridlines, all status in text + shape.

---

## 10. State Management

| Concern | Lives in | Why |
|---|---|---|
| Brief text (pre-extraction) | client state in `<BriefInput/>` | ephemeral; refresh loss OK |
| Extracted `Brief` (form) | `react-hook-form` seeded from server prop | RHF + zod resolver mirrors AI engineer's schema |
| Plan (committed) | Vercel Postgres, hydrated as `initialPlan` prop | URL canonical; refresh restores |
| Plan (in-flight) | `useState` in `<PlanWorkspace/>`, appended via AI SDK hook | partial→state→table |
| Edits (uncommitted) | `useState<PlanLine[]>` + diff vs `originalLines` | optimistic; persisted via Server Action per edit |
| Edit count | derived selector `(currentLines, originalLines)` | one source of truth |

**Original plan stays pinned on the server record** (`plans.brief_snapshot`). Edits diff against it — "edits diverging from model output" is the team's signal, not "edits since previous edit."

### Edit capture event

```ts
export type EditEvent = {
  edit_id: string;
  plan_id: string;
  line_id: string | null;
  field: 'spendPct' | 'rationale' | 'allocationRationale' | 'dspJustification';
  before: string | number;
  after: string | number;
  user_id: string;
  ts: string;
  prompt_version: string;
  session_id: string;
};
```

Optimistic update lands instantly. Server Action runs in `startTransition`. Failed write toasts "edit not saved, retry" — does **not** roll back UI (losing keystrokes is worse than losing one server write). Debounce prose at 600ms on blur; spend % fires on commit (Enter/blur).

### Confirmation form schema

```ts
import { z } from 'zod';
export const briefSchema = z.object({
  advertiser: z.string().min(1),
  vertical: z.string().min(1),
  budgetDollars: z.number().int().positive(),
  flightStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  flightEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kpi: z.enum(['VCR','CTR','CPM','CPA','Viewability','Reach']),
  goal: z.enum(['awareness','consideration','performance']),
  geo: z.array(z.string()).min(1),
  audience: z.string().min(1),
  inventoryConstraint: z.enum(['premium','open','mixed']),
  exclusions: z.array(z.string()),
  channelsInScope: z.array(z.string()).min(1),
});
```

Each field's `onBlur` fires `logFieldEdit` — confirmation-step edits feed the same telemetry stream.

---

## 11. Streaming UX

Vercel AI SDK `streamObject` from `ai` package; server route at `app/api/plans/[id]/stream/route.ts` returns a stream typed against `Plan.lines[]`. Client uses `useObject({ api, schema })` exposing a partial `lines` array that grows as tokens arrive.

**First 5 seconds:**
1. **0.0s** — User clicks "Generate plan". Server Action `createPlan` writes brief, returns plan id.
2. **0.3s** — `/plans/[id]` mounts. Renders header, collapsed brief banner, table with 8 skeleton rows (`expectedLineCount` default).
3. **0.5s** — Stream opens. Pulsing dot in footer: "Drafting plan…"
4. **3–8s** — First line resolves: skeleton replaced with `motion-safe:animate-in fade-in duration-200`.
5. **5s** — User sees brief banner editable, first 1–2 real lines, rest pending. Can scroll, expand gate summary, or wait.

**Skeleton:** widths match the colgroup exactly so no reflow when rows land. `motion-safe:animate-pulse` only — on `prefers-reduced-motion` the pulse stops; real rows still distinguishable by text content. No shimmer.

**Mid-stream error:** keep rendered rows; replace remaining skeletons with a single full-width row: "Generation stopped at line N of M. [Resume] [Start over]". Sentry captures the partial-stream error with `planId`, `linesReceived`.

---

## 12. Error and Edge States

| State | What the user sees | Action | Sentry |
|---|---|---|---|
| Empty `/plans` | "No plans yet." + `[Draft a new plan]` + faded sample plan, captioned "What a plan looks like." | Click CTA | none |
| Empty plan output | Card: "The agent returned zero lines. The brief is likely underspecified. [Edit brief] [Retry]" | Edit/retry | warn `empty_plan_returned` |
| Model timeout (30s) | Inline: "Agent is taking longer than usual…" → at 60s "Generation timed out. [Try again] [Edit brief]" | Retry/edit | error `generation_timeout` |
| Schema mismatch | Red-bordered banner: "The agent returned an invalid plan. Team notified. [Try again]" | Retry | error `schema_validation_failed` |
| Stream drop | See §11 mid-stream | Resume/restart | warn `stream_aborted` |
| Edit conflict | Toast: "Edit not saved. [Retry]" — value remains in cell | Retry/re-type | warn `edit_persistence_failed` |
| Export failure | Toast: "Export failed — [Try again] or [Copy as markdown]" | Try again | warn `export_failed` |
| Auth expired | Full-page: "Your session expired. [Sign in]" — return URL preserved | Sign in | none |
| Not found / not owned | 404: "Plan not found. [See your plans]" | Back to list | warn `plan_not_found` |

---

## 13. Flow Diagrams

### Happy path
```
1. /plans (list)
2. [Draft new] → /plans/new
3. Paste brief → [Draft plan]
4. createDraft → calls extractBrief → writes brief, returns planId
5. Navigate /plans/[id]
6. <PlanWorkspace/> hydrates: confirmation expanded, table empty (skeletons)
7. User scans extraction → [Generate plan]
8. Stream opens → /api/plans/[id]/stream
9. Lines resolve one by one; DSP justification column lights amber on DSP rows
10. Stream completes → totals settle, validation pass
11. User edits PubMatic Spend (35→40), TTD Rationale
    ↳ optimistic update + logEdit
    ↳ EditsCapturedIndicator → "2 edits captured"
12. ExportMenu → "Export CSV (for AdOps)" → download
```

### Recovery path
```
1–8. Same as happy path.
9. Stream stalls at 30s — no tokens.
10. Inline: "Agent is taking longer than usual…"
11. At 60s, abort. Inline panel: "Generation timed out. [Try again] [Edit fields and retry]"
12. [Try again] → same brief, new stream.
13. Stream succeeds. Plan renders.
14. Sentry retains the first failure with planId.
```

---

## 14. Microcopy (terminology locked)

| Surface | Copy |
|---|---|
| Brief heading | "Paste a campaign brief" |
| Brief sub | "The agent extracts structured fields, then drafts a media plan with SSP-direct as the default and DSPs only where they earn a seat." |
| Brief CTA | **"Draft plan"** |
| Brief example | "Use the cosmetics example" |
| Confirmation heading | "Confirm the brief" |
| Confirmation sub | "Edit any value before generating — edits become structured signal for the team." |
| Confirmation CTA | **"Generate plan"** |
| Confirmation back | "← Rewrite the brief" |
| Workspace heading | "Draft plan — {advertiser}" |
| Edits pill | "{N} edit{s} captured — these become structured feedback for the planning agent." |
| DSP gate, none earned | "DSP gate · no DSP earned a seat on this plan" |
| DSP gate, N earned | "DSP gate · {N} DSP{s} earned a seat ({names}), {M} rejected" |
| Export menu items | "Export CSV (for AdOps)", "Copy as markdown" |
| Markdown ack | "Copied" (1.8s) |
| Regenerate confirm | "Regenerate will replace your current draft and discard {N} edit{s}. Continue?" |
| New plan confirm | "Start a new plan? Your current draft is saved at this URL." |
| Empty `/plans` | "No plans yet." + "Draft your first plan" |
| Error template | "We couldn't generate this plan — {reason}. [Try again] [Edit fields and retry]" |

**Terminology lock:** "plan" everywhere. Not "campaign plan." "Draft plan" is the heading qualifier; otherwise "plan."

---

## 15. Accessibility Baseline

- **Contrast:** WCAG AA. Tailwind `zinc-700` on white = 4.5:1 minimum. `amber-900` on `amber-50` for DSP justification cell.
- **Focus:** shadcn 2px ring on every `<input>`, `<button>`, `<textarea>`. Tab order across the table: row by row, left to right, landing only on editable cells; non-editable wrappers use `tabIndex={-1}`.
- **Color is never the only signal:** DSP rows get amber color **plus** left border **plus** populated text. Over-ceiling warning: amber text **plus** triangle glyph **plus** literal "over ceiling of X%."
- **Motion:** `motion-safe:animate-pulse` only; reduced motion → static "Generating…" line count.
- **Live regions:** streaming footer in `aria-live="polite"`; edits pill in `aria-live="polite" aria-atomic="true"`.
- **Esc** collapses expanded rationale textarea without saving; **Enter** on spend % commits and advances focus to next row's spend cell.

---

# PART C — QA, EVALUATION & CI

## 16. Wrong-Plan Taxonomy → Detection

| Class | Detection | Severity | Test class |
|---|---|---|---|
| DSP-default creep | `dsp_share_threshold` per class: pure-SSP 0%, YouTube 25%, retargeting/retail 40%, mixed 15% | Hard | pure-SSP, retail-performance, underspecified-edge |
| Justification absence | `dsp_justification_present_and_nonempty` (regex: ≥40 chars, references ≥1 brief token) | Hard | YouTube-in-scope, retargeting, retail |
| Justification stubbing | LLM judge `dsp_justification_adequacy` | Soft | same as above |
| Capability hallucination | `capability_ids_resolve` lookup | Hard, zero tolerance | All |
| Deal hallucination | `deal_refs_resolve` lookup | Hard, zero tolerance | All |
| Constraint violation (machine-checkable) | `geo_subset_of_brief`, `inventory_matches_brief`, `exclusions_respected` | Hard | premium, retargeting |
| KPI/channel mismatch | `kpi_channel_match` lookup table (VCR→video/CTV; CTR→display/social; CPA→performance; Viewability→display/video; Reach→video/CTV/display; CPM→any) | Hard | underspecified-edge, retail |
| Budget errors | `shares_sum_to_100` (tol 0.5%), `dollars_match_budget`, `no_negative_shares` | Hard | All |
| Rationale quality | LLM judge pairwise vs reference | Soft | All |

---

## 17. Golden Brief Set

**Count: 20 briefs** (PRD floor is ≥15). Owned in `evals/briefs/`, JSON, PR-versioned.

| Category | Count | What's tested |
|---|---|---|
| pure-SSP | 5 | Premium video, no DSP-eligible signal. Expected DSP share = 0%. |
| YouTube-in-scope | 4 | Forces justified DV360. DSP share 10–25%, justification cites YouTube uniqueness. |
| retargeting-performance | 3 | Retargeting pool + CPA. DSP earns 25–40%. |
| retail-performance | 3 | Amazon retail, CPA, Amazon DSP eligible. 20–40%. |
| underspecified-edge | 3 | Missing KPI or geo. Extractor flags; generation blocked until confirmed. |
| contradictory | 2 | Premium + sub-$5 CPM, or "no UGC" + TikTok. Plan respects hard constraint, surfaces tension. |

**Repo layout:**

```
evals/
  briefs/
    pure-ssp-cosmetics.json
    youtube-auto.json
    ...
  expected/
    pure-ssp-cosmetics.json
    ...
  fixtures/
    catalog-snapshot.json
    deals-snapshot.json
  judges/
    rationale_quality.v1.md
    allocation_rationale_quality.v1.md
    dsp_justification_adequacy.v1.md
  reference-prompt-version.txt
  manifest.json
```

**Brief schema** (`evals/briefs/*.json`):
```json
{
  "id": "pure-ssp-cosmetics",
  "category": "pure-SSP",
  "text": "Cosmetics brand, CAD $400K, May–June, VCR KPI, Canada, W25–54, premium inventory only, no UGC, video.",
  "extractedBrief": { /* Brief */ },
  "thresholdOverrides": { "dspShareMaxPct": 0 }
}
```

**Reference plan** (`evals/expected/*.json`):
```json
{
  "briefId": "pure-ssp-cosmetics",
  "authoredBy": "<named-strategist>",
  "authoredAt": "2026-05-14",
  "promptVersion": "v0.3.0",
  "expectedChannelMix": [
    { "channel": "premium-video", "vendorType": "SSP", "sharePctRange": [55, 75] },
    { "channel": "ctv",          "vendorType": "SSP", "sharePctRange": [15, 30] },
    { "channel": "publisher-direct", "vendorType": "AdCP", "sharePctRange": [15, 30] }
  ],
  "requiredCapabilityIds": ["pubmatic-premium-video", "magnite-ctv-deals"],
  "forbiddenVendorTypes": ["DSP"],
  "referencePlan": { /* Plan */ }
}
```

**Sign-off flow:** Named Strategist (PRD open question #1, ~4 hrs/week) reviews each reference in a PR. CODEOWNERS rule on `evals/expected/**` forces their approval. Each reference carries `authoredBy` + `authoredAt`. Quarterly re-validation, or on model swap. **Without a named human, the eval cannot ship.**

---

## 18. Deterministic Checks

Implemented in `evals/checks/`, signature `(plan, brief, fixtures) → { name, passed, severity, detail }`.

| Check | Pass rule | Severity |
|---|---|---|
| `schema_conforms` | Zod parse against locked plan schema | Hard |
| `shares_sum_to_100` | `|sum − 100| ≤ 0.5` | Hard |
| `dollars_match_budget` | `|sum − budget| ≤ $1` | Hard |
| `no_negative_shares` | All ∈ [0, 100] | Hard |
| `capability_ids_resolve` | Every id in catalog | Hard, 0-tol |
| `deal_refs_resolve` | Every ref in snapshot | Hard, 0-tol |
| `dsp_justification_present_and_nonempty` | DSP lines: ≥40 chars, mentions ≥1 brief token | Hard |
| `non_dsp_lines_no_justification` | Non-DSP: `dspJustification === null` | Hard |
| `dsp_share_threshold` | ≤ category threshold | Hard |
| `geo_subset_of_brief` | Plan geo ⊂ `brief.geo` | Hard |
| `inventory_matches_brief` | Premium → no `open-exchange` capabilities | Hard |
| `kpi_channel_match` | Static KPI→channel lookup | Hard |
| `share_ceiling_respected` | DSP `spendPct ≤ shareCeiling` | Hard |
| `dsp_gate_summary_consistent` | Lines and `dspAssessment` agree | Hard |
| `required_capabilities_present` | ≥1 of `requiredCapabilityIds` | Soft |
| `channel_mix_within_range` | Each share within ±10pp of reference range | Soft |

Reuse the existing `validate.ts` helpers — extend, don't replace.

---

## 19. LLM-Judge Harness

**Judge model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`). Cheaper, faster, and weak enough that it won't paper over generator failures with its own ideas of a good plan.

**Pairwise vs absolute:** Pairwise against reference plan. Absolute drifts ~0.5 points/month on a 1–5 rubric as the judge's prior shifts; pairwise stays stable because both sides move together. Pairwise also matches how the named Strategist will calibrate.

**Three judges per plan** — `rationale_quality`, `allocation_rationale_quality`, `dsp_justification_adequacy` (last one only on plans with DSP lines). Each emits `{winner: A|B|tie, confidence: 1-5, reasons: string}`. Win rate aggregated across 20 briefs.

### Rubric — `rationale_quality`
```
Compare two media-plan rationales for the same brief.

Prefer the rationale that:
- Names the specific KPI from the brief and ties channel to it.
- References at least one brief constraint (geo, inventory, exclusions, audience).
- Names the capability/deal type by category, not generic ad-tech adjective.
- Defends WHY THIS VENDOR over an alternative the Strategist might pick.
- Stays under 80 words; verbosity is not quality.

Penalize:
- Boilerplate ("leverages premium inventory") with no brief-specific anchor.
- Contradicts the brief (premium claim against open-exchange capability).

Output: {winner: "A"|"B"|"tie", confidence: 1-5, reasons: string}.
```

### Rubric — `allocation_rationale_quality`
```
Compare two allocation rationales for the same plan line.

Prefer:
- Names the share % and why it is that number, not larger or smaller.
- Names the brief constraint driving the share (budget, KPI weight, geo).
- Names a trade-off vs an alternative share.
- For DSP: references the share_ceiling and its reason.

Penalize:
- Restates the rationale instead of defending the number.
- Asserts a share with no driving constraint.

Output: {winner, confidence, reasons}.
```

### Rubric — `dsp_justification_adequacy`
```
Compare two dsp_justification strings on the same DSP line.

Prefer the one that explicitly covers all three:
- What's unique to this DSP (inventory, data, signal SSP/AdCP cannot match).
- What SSP-direct or AdCP CANNOT do for this brief — name the counterfactual.
- Why this share, not larger.

Penalize:
- Asserts uniqueness without naming the source.
- Recycles the line rationale.
- Under 40 or over 120 words.

HARD FAIL (winner = "neither", confidence = 5) if SSP/AdCP counterfactual not named.

Output: {winner, confidence, reasons}.
```

**Calibration:** Once per sprint and on every judge prompt change, the named Strategist labels 30 plan pairs blind. **Cohen's kappa between judge and Strategist must be ≥0.6** per rubric; below that the rubric is revised before the eval is trusted. Drift detection: monthly re-run; alert if kappa drops >0.1. Judge model pinned to specific version (e.g., `claude-haiku-4-5-20251001`), not "latest." Re-calibrate on every judge model bump.

---

## 20. Edit-as-Signal Capture (Online Eval)

The `EditEvent` schema from §10 lands in `app.plan_edits`. Aggregates watched weekly:

| Metric | Definition | Threshold/use |
|---|---|---|
| `edits_per_plan_p50` | Median edits per accepted plan | PRD trust metric: ≤3 |
| `spend_pct_edit_magnitude_p50` | Median |Δ| on spendPct edits | Allocation drift indicator |
| `regenerate_rate` | Plans with ≥2 generations per session | Plan unusable as draft |
| `time_to_accept_p50` | First-generate → first-export | Coordinate with latency budget |
| `abandoned_plan_rate` | Created, 0 edits, 0 export in 24h | Abandoned ≠ accepted |
| `dsp_share_edited_down_rate` | % of plans where Strategist lowered a DSP `spendPct` | **Smoking gun for DSP-default creep that beat the regression suite** |

Sprint 1 ships a single Next.js dashboard route reading Postgres, refreshed nightly. Weekly review meeting reads it. No real-time alerting yet.

**Plan-level "N edits captured" indicator** reads `COUNT(*) FROM plan_edits WHERE plan_id = $1` — same table the eval reads.

---

## 21. CI Architecture (GitHub Actions)

**Workflow file:** `.github/workflows/eval.yml`.

**Triggers:**
- `pull_request` paths: `prompts/**`, `src/lib/extract.ts`, `src/lib/generatePlan.ts`, `src/lib/validate.ts`, `src/lib/types.ts`, `evals/**`, `model.config.json`.
- `schedule`: nightly 02:00 UTC against `main` (catches upstream model regressions on quiet days).
- `workflow_dispatch` for manual runs after model swap.

**Job graph:**
```
lint ─┐
      ├─> typecheck ─> deterministic_eval ─[passed]─> llm_judge_eval ─> comment_pr
unit ─┘                       │
                              └─[failed]─> comment_pr (judge skipped)
```

`deterministic_eval` gates `llm_judge_eval`. A plan that fails schema is not worth judging.

**Flaky LLM handling:**
- Generator: `temperature: 0.2`. Single retry on API error only, none on content failure.
- Judge: `temperature: 0`, three judges per (plan, brief), winner via 2-of-3 majority; ties resolved as "tie."
- Each brief runs independently; one timeout fails only that brief.

**Result artifact:** `evals/results/<run-id>/`:
- `summary.json` — per-check pass rates, per-judge win rates.
- `per-brief/<brief-id>.json` — full plan + check + judge details.
- `report.md` — PR comment with delta vs baseline.

**PR comment shape:**
```
KleverOne Eval — Prompt v0.4.1
Hard gates: 8/8 passed
Soft gates: 4/5 passed (rationale_quality 82% vs 85% baseline — flagged)
DSP share on pure-SSP set: 0% (5/5) ✓
Capability hallucinations: 0 ✓
Latency p95: 24s ✓
Full report: <artifact-link>
```

**Baseline:** Last green `main` run's `summary.json` mirrored to `evals/baseline/summary.json` on every green merge. No manual approval — green is green.

---

## 22. Ship Gates (the hard numbers)

| Gate | Threshold | Why |
|---|---|---|
| Schema conformance | 100% | Break means export + UI both fail (PRD §6 Story 5) |
| Capability hallucinations | 0 across 20 briefs | Catalog static, lookup is string match — non-zero = broken prompt |
| Deal hallucinations | 0 across 20 briefs | Same logic with snapshot |
| DSP share on pure-SSP set | ≤15% (PRD floor); **0% target** | The single regression the product exists to prevent |
| DSP justification non-empty on every DSP line | 100% | A DSP line without justification IS the failure mode |
| p95 generation latency | ≤25s end-to-end | 5s buffer within AI engineer's 30s ceiling |
| `rationale_quality` judged win rate | ≥45% | Below 45% = decisively worse than reference; 50% = parity |
| `allocation_rationale_quality` judged win rate | ≥45% | Same logic; this is the AC the Strategist edits against |
| `dsp_justification_adequacy` judged win rate | ≥50% | DSP justification *is* the product — parity floor, no regression accepted |
| `winner=neither` rate on DSP-justification judge | 0 | Means SSP/AdCP counterfactual missing — even one is core-pattern loss |

PR cannot merge with any hard gate failing. Soft-gate regression requires Strategist approval on PR thread before merge.

---

## 23. Failure Clustering and Triage Workflow

```
1. Cluster. Group failing briefs by the deterministic check that tripped or the
   judge dimension that dropped. The cluster is the hypothesis: "DSP creep on
   YouTube briefs only," not "the eval is unhappy."
2. Drill. For each cluster, pull the 3 worst examples from model_calls
   (is_eval_run=true, run_id=<failing-run>). Read prompts, outputs, judge reasons.
3. Diff. Compare failing prompt version vs last green (git diff on prompts/).
   One commit usually owns the regression.
4. Reproduce. npm run eval:single -- <brief-id> against suspect commit and the
   previous green. The diff in outputs is the bug.
5. Fix or accept. Either prompt regressed (revert/patch) or reference plan is
   stale (update with named-Strategist PR approval per §17).
6. Grow the suite. If the regression slipped past existing briefs, the cluster's
   signature becomes a new brief in evals/briefs/. The suite grows on every miss.
```

Lives in `evals/TRIAGE.md`, invoked by AI engineer on every red CI; full-stack engineer handles dashboard surfacing.

---

# PART D — CROSS-CUTTING

## 24. Auth, Identity, Secrets

**v1:** Auth.js (NextAuth v5) with Email/Magic-Link provider, backed by `app.users`. Email allowlist enforced in `signIn` callback; reject any email not in `ALLOWLIST_EMAILS`. Sessions as JWTs in HTTP-only cookies. **On top of that**, Vercel "Vercel Authentication" deployment protection on production — the public URL itself requires Vercel team login before any app code runs (defense in depth, zero engineering hours).

**Alternative considered (Clerk):** rejected for v1. `app.users` is the load-bearing identity surface every future agent inherits — owning it locally is correct.

**Why not Vercel Authentication alone:** gates the URL, doesn't give a stable user record. The buying agent inherits `app.users.id` — that record has to exist from day one or every future agent retrofits identity attribution.

**Path to OIDC (post-v1):** Klever's IdP (likely Google Workspace; possibly Okta/Entra) lights up by adding the matching Auth.js provider and dropping email. Migration is hours, provided `users.email` stays the join key. Add `provider` + `provider_subject` columns when SSO ships; v1 omits.

### Env vars (Vercel project settings; never committed)
```
ANTHROPIC_API_KEY
DATABASE_URL                  # Vercel Postgres pooled
DATABASE_URL_UNPOOLED         # for migrations
BLOB_READ_WRITE_TOKEN         # Vercel Blob for deal snapshots
AUTH_SECRET                   # NextAuth JWT signing
AUTH_URL                      # production URL
EMAIL_SERVER                  # SMTP (Resend recommended)
EMAIL_FROM
ALLOWLIST_EMAILS              # comma-separated
SENTRY_DSN
SENTRY_AUTH_TOKEN             # source-map uploads at build
CRON_SECRET                   # validate Vercel Cron header
```

---

## 25. Observability, Logging, Prompt Versioning

**Errors:** `@sentry/nextjs` wired via `instrumentation.ts`. Server + client capture. `release` set to git sha so stack traces map.

**Model-call log:** every Anthropic call writes one `model_calls` row inside the same transaction as the plan/brief it produced (or before, with `plan_id = null` for failed calls). **Postgres is the right home, not Logflare** — rows join to plans/users for debugging ("show me every plan Alice generated last week with prompt v1.3"). Logflare would be a second store with no join surface.

What's logged: full request (messages, tools, system), full response, token counts split by cache-read/write/input/output, computed `cost_usd`, latency, validation result, retry chain.

**Confidentiality posture:** Strategist briefs may contain client-confidential information. Treat `model_calls.request` as confidential; restrict the analytics Postgres role from reading it. Document a 90-day retention policy with a scheduled prune job (flagged for sprint 2).

**Prompt versioning scheme:** semver + git sha + content hash, all in `prompt_versions`. Prompts live as TS template functions in `/src/lib/prompts/extract.ts` and `/src/lib/prompts/generate.ts`. On boot, the pipeline renders each prompt against a canonical fixture, hashes it, and looks up or inserts the `prompt_versions` row. Semver bumps are manual; **hash drift without a bump is a CI failure**. Every plan and every model call carries `prompt_version_id` — any plan ever generated can be regenerated bit-for-bit (given the same model + catalog + snapshot).

---

## 26. Risks (Consolidated)

| Risk | Layer | Mitigation |
|---|---|---|
| Catalog drift without a forcing function | Backend | Catalog owner named (PRD #2) before sprint end; weekly "catalog last-modified" Slack check starting week 3 |
| Snapshot vs live deal data divergence | Backend | Name the snapshot `planning-deal-snapshot-*`; buying agent's freshness requirement is an explicit handoff problem |
| `brief_snapshot` denormalization mishandled | Backend | `getPlanInputBrief(planId)` helper; PR convention banning direct `plans → briefs` joins for input reads |
| Prompt regresses to DSP-default | AI / Eval | Hard gate on DSP share in CI (§22) |
| LLM hallucinates `capability_id` / `deal_ref` | AI / Eval | Post-validation rejects; structured output forces resolution |
| Strategists distrust output, revert to slides | Frontend | Inline-editable plan + visible allocation rationale + edit telemetry to close the loop |
| Schema needs to change once GAM shape lands | Backend / PRD | Treat schema as v1; reserve v2 migration; keep export layer thin (PRD open question #3) |
| Golden set staleness (references no longer reflect "good") | Eval | Quarterly named-Strategist re-review; online edit rate as leading indicator |
| Judge drift (judge silently changes preferences after vendor update) | Eval | Pin judge model version; monthly kappa re-measurement; alert on drop >0.1 |
| Deterministic checks insufficient (failure class slips through) | Eval | Top-10 most-edited fields classified quarterly → add check, tighten judge, or add brief |

Out-of-scope risks worth knowing about: prompt injection via brief text (brief is consumed as untrusted user content; tool-use schema is the boundary), Anthropic rate limits (sprint-1 volume too low to hit).

---

## 27. Composability — What the Next Agents Inherit

| Surface | Load-bearing because |
|---|---|
| `app.users` (email, id) | Every future agent attributes work to a Strategist; SSO migration touches one table |
| `app.briefs` (raw + extracted + edit log) | Buying agent reads the same brief that produced the plan; reporting agent learns from extraction edits |
| `app.plans` + `app.plan_lines` | Buying agent's input. Already shaped against GAM line-item translatability (path/channel/vendor/deal_refs/capability_ids). **PRD open question #3 must close before this schema is v1-final**, or buying agent inherits a translation layer |
| `app.plan_edits` | Optimization agent's training signal — highest-fidelity feedback the platform will ever get |
| `app.model_calls` + `app.prompt_versions` | Reproducibility, A/B prompt comparisons, regression debugging across all agents |
| Capabilities catalog (`/src/data/catalog`) | Shared vocabulary. Buying agent activates what planning agent referenced; reporting agent measures them. **One catalog, one source.** |
| Deal snapshot (`planning-deal-snapshot-*`) | Planning-grade freshness only. Buying agent owns its own live path. |

**Sprint-1-only, replaced later:** email-magic-link auth (→ SSO), deal-snapshot seed JSON (→ SSP MCP calls), hardcoded DSP gate rules (→ data-driven once >~10 conditions, but that's months away).

---

## 28. Verification To-Dos Before Implementation

Two confirmations the engineers should make on day one of sprint:

1. **Anthropic prompt-caching availability** for `claude-sonnet-4-6` on the team's account tier. If still in beta header territory, confirm header name and TTL.
2. **Next.js 16 streaming pattern.** This architecture uses a Route Handler for streaming because Server Functions return a single response per the docs at `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` and `15-route-handlers.md`. If Next 16 has added a streaming-action pattern not in those docs, prefer it.

Neither blocks sprint planning — both shift specific lines, not architecture.

---

## 29. Sprint 1 Execution Plan (suggested split, 2 engineers × 10 days)

| Day | AI engineer | Full-stack engineer |
|---|---|---|
| 1 | Lock `Brief` and `Plan` schemas; port `assessDspGate`; prompt v0 for extraction | Project bootstrap, Auth.js + allowlist, Sentry, Postgres + Drizzle, `instrumentation.ts` |
| 2 | Extraction pipeline + retry + validator; first model_calls write | Route map, `AuthShell`, `/plans` list with empty state |
| 3 | Generation prompt v0 with full catalog; tool-use `emit_plan`; partial-JSON streaming | `BriefInput` + Server Action `createDraft`; `/plans/new` |
| 4 | Post-validation (`capability_ids_resolve`, share sums, justification rules) | `ExtractedBriefConfirmation` with RHF+zod; field-level edit capture |
| 5 | Wire `/api/plans/generate` SSE; first end-to-end happy path | `PlanWorkspace` skeleton; `PlanTable` columns + types + skeleton rows |
| 6 | Golden brief set v0 (10 briefs); deterministic checks (`shares_sum_to_100`, `capability_ids_resolve`, `dsp_share_threshold`) | Streaming render; inline edit (Spend %, Rationale, Allocation); `logEdit` action |
| 7 | Remaining briefs to 20; remaining deterministic checks; CI workflow `eval.yml` scaffold | `DspGateSummary`; `EditsCapturedIndicator`; `ExportMenu` (CSV + markdown) |
| 8 | Judge rubrics v0; calibration set; pairwise harness | Error states (timeout, schema mismatch, stream drop); error.tsx |
| 9 | Tune prompts against eval; first PR-comment artifact | Polish: tabular figures, mono fonts, accessibility audit, focus order |
| 10 | Ship gates locked; documentation; named-Strategist sign-off on reference plans | Internal walk-through; deploy; smoke test with pilot Strategist |

Buffer: half a day each for the surprises that will appear in week two.

---

## Critical Files for Implementation

- `C:\AI PROJECTS\KleverOne\planning-agent-mock\src\lib\types.ts` — contract starting point; refine to add `path`, `share_ceiling`, `share_ceiling_reason` on `PlanLine` and a `BriefEdit` type
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\src\lib\generatePlan.ts` — port `assessDspGate` verbatim as the deterministic stage-2 gate; the LLM call replaces `premiumAwarenessPlan` / `performancePlan`
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\src\lib\validate.ts` — extend with capability/deal-ref resolution, ceiling enforcement, justification-presence rules
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\src\lib\catalog.ts` — move catalog out to `/src/data/catalog/capabilities.json`; rewrite this file as a typed loader + helpers
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\src\components\PlanTable.tsx` — preserve the dedicated-justification-column pattern; extend with edit affordances
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\src\components\ConfirmationView.tsx` — replace with RHF + zod implementation; per-field edit capture
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\node_modules\next\dist\docs\01-app\01-getting-started\07-mutating-data.md` — Next.js 16 Server Functions reference
- `C:\AI PROJECTS\KleverOne\planning-agent-mock\node_modules\next\dist\docs\01-app\01-getting-started\15-route-handlers.md` — Next.js 16 Route Handlers + streaming reference
