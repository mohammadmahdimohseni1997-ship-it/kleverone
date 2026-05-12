# KleverOne Planning Agent — Sprint 1 Submission

## Premise

The planning agent's job is to produce a first-draft media plan a Strategist will actually use, with SSP-direct as the default, in a way that breaks the DSP-default habit. That is both a product and a cultural mechanic. The output must make the SSP-direct-first / DSP-as-exception logic *visible and defensible* — not just true in the model's prompt. Sprint 1 ships the slice that validates that thesis end-to-end, plus the regression suite that protects it from week-two prompt regressions.

---

## User stories with acceptance criteria

### Story 1 — Brief intake and confirmation

*As a Strategist, I paste a campaign brief in plain language and confirm what the agent extracted before it drafts the plan.*

**Acceptance criteria**

- Strategist pastes free-text brief; the agent returns a structured extraction within 60s.
- Confirmation view shows the extracted fields: advertiser, vertical, budget, flight, KPI, goal, geo, audience, inventory constraint, exclusions, channels in scope.
- Every field is inline-editable before plan generation.
- Field-level edits (`field`, `from`, `to`) are captured as structured events with `plan_id`, `strategist_id`, `timestamp`.
- Fields the agent could not extract with confidence are marked "needs review" inline; the Strategist must confirm or correct them before "Generate plan" is enabled.

### Story 2 — Plan with SSP-direct-first reasoning and a defended DSP gate

*As a Strategist, I receive a draft media plan in which SSP-direct is the default and any DSP line carries a justification I can defend to a client.*

**Acceptance criteria**

- For briefs without DSP-eligible signals (no YouTube in scope, no retargeting pool, not retail-performance), the plan contains **zero** DSP lines.
- For briefs with one or more DSP-eligible signals, every DSP line includes a required `dsp_justification` naming (a) what the DSP uniquely provides, (b) what the SSP-direct or AdCP counterfactual cannot do, (c) why this share and not more.
- A plan-level "DSP gate" summary shows which DSPs were considered, which earned a seat, and which were rejected with reason text.
- Every `capability_id` and `deal_ref` in the output resolves to a valid catalog or deal-snapshot entry; any hallucination triggers one bounded retry and otherwise fails the generation.
- Line shares sum to 100% of the brief budget; spend dollars derive from share × budget.

### Story 3 — Allocation reasoning that defends itself against edits

*As a Strategist, every line tells me why it got the share it did, and when I edit a DSP line above its share ceiling the agent's original reasoning is surfaced inline.*

**Acceptance criteria**

- Every plan line has an `allocation_rationale` distinct from the `rationale`; the allocation rationale names the specific share, the brief's KPI/constraint it serves, and at least one trade-off vs an alternative share.
- For DSP lines, the `dsp_justification` includes a `share_ceiling` and the reason for that ceiling.
- When a Strategist edits a DSP line's share above the ceiling, the UI surfaces the original ceiling and reason in the row (not tooltip-only).
- Edits to allocation rationale or rationale are captured as structured events alongside spend edits.

### Story 4 — Edit, capture, and hand off

*As a Strategist, I edit the plan inline, my edits become structured feedback, and I can hand the plan off in a format AdOps will accept.*

**Acceptance criteria**

- Spend %, rationale, and allocation rationale are inline-editable; total recalculates on change and flags non-100% totals.
- The plan view shows an "N edits captured" indicator any time the current plan diverges from the original draft, with a count.
- Strategist can export the plan as CSV with a stable column order (vendor, type, channel, spend %, spend $, deal/PMP, capabilities, rationale, allocation rationale, DSP justification).
- Strategist can copy the plan as markdown for paste into Slides, Notion, or email.
- Plans persist per user; Strategist can return to a previously generated plan via a stable URL.

### Story 5 — Regression-protected DSP default (team story)

*As the planning team, we can detect DSP-default creep before a prompt change or model swap ships to a Strategist.*

**Acceptance criteria**

- A regression brief set of ≥15 cases covers: pure-SSP briefs, YouTube-in-scope briefs, retargeting-pool performance briefs, retail-performance briefs, and underspecified-brief edge cases.
- The eval suite runs on every prompt or model-version change in CI; results are written to a versioned log.
- Hard gates (any failure blocks deploy): schema conformance 100%, zero capability/deal hallucinations, DSP share ≤ 15% on pure-SSP briefs, every DSP line carries non-empty `dsp_justification`.
- Soft gates (LLM-judged vs reference plans on a rubric): rationale quality, allocation reasoning quality, DSP justification adequacy — reported per change, regressions reviewed before merge.

---

## Sprint 1 vs deferred

**Ships in the two-week sprint:** brief intake + confirmation with edit telemetry; plan generation with a deterministic DSP gate and LLM-driven rationale / allocation reasoning; structured plan output with required `dsp_justification` on DSP lines; inline editing on spend, rationale, and allocation rationale, with structured edit capture; CSV and markdown export; the regression suite (≥15 golden briefs, deterministic checks, LLM-judge rubric, CI integration); per-user plan persistence on Vercel Postgres; auth via Vercel-protected route with email allowlist; observability (Sentry, prompt versioning, prompt/output call logs). **Cut from v1:** live SSP/DSP MCP calls during generation (use a daily-refreshed deal/PMP snapshot — live calls are a *buying* agent's concern); AdCP integration (stub publisher-direct slots as named placeholders if AdCP isn't MCP-shaped yet); ad-server line export to GAM (CSV is enough — trafficker pastes into their flow); catalog admin UI (catalog stays as committed JSON in repo with documented update PRs); brand identity polish (placeholder neutral chrome until brand assets land); history sidebar and shareable plan URLs beyond the stable per-user URL; low-confidence flagging on extracted fields (requires model-side confidence the v1 extractor won't emit cleanly — revisit when richer extraction lands). **Why this cut:** the thesis is *an agent producing first-draft plans Strategists will use, with SSP-direct-first reasoning visible and defended against regression* — that thesis ships only if the eval harness ships with it, otherwise the cultural mechanic regresses on the first prompt tweak and we ship a demo not a product. LLM-assisted development is what lets us put the eval suite *in* sprint 1 rather than punting it; the velocity gain on code is what buys the discipline to ship the regression layer that normally gets cut.

---

## Top 3 questions before writing another line of this brief

1. **Who is the named authority on "this is a good plan"?** The eval suite and LLM-judge prompts have to calibrate against a human's judgement. Without one committed senior Strategist (or AdOps lead, or planning director) signing off on the golden brief set and the rubric — and available for ~4 hours/week through sprint 1 — the eval drifts and the cultural mechanic loses its anchor.

2. **Is the capabilities catalog fit for purpose today, and who owns its content?** The brief describes a catalog with description, channels, KPIs served, and known limitations. Is every entry populated, accurate, and current right now? If not, sprint 1 starts with content cleanup, which is outside the two-engineer scope. We need the catalog owner named and the current state confirmed before we lock the prompt and the eval.

3. **What does "ad server source of truth" mean concretely for the plan-output schema?** Even though v1 doesn't write to the ad server, the plan schema has to remain *translatable* to the ad server's insertion order / line item shape — otherwise the buying agent inherits a translation layer that didn't have to exist. We need to see GAM's (or equivalent) line-item structure before locking the v1 plan schema.
