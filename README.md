# KleverOne — Planning Agent

KleverOne is an internal agentic platform for Klever, a Canadian programmatic agency shifting from DSP-default buying to **SSP-direct as the default**, AdCP / publisher-direct for premium inventory, and **DSPs as the justified exception**.

This repo contains the Sprint 1 deliverable: PRD, full-stack architecture, and a Next.js mock with a working Kimi-powered planning agent.

## Repo contents

| Path | What |
|---|---|
| `submission.md`, `submission-v2.pdf` | Original Sprint 1 submission (user stories, sprint cut, open questions) |
| `PRD.md`, `PRD.pdf` | Product Requirements Document derived from the submission |
| `ARCHITECTURE.md`, `ARCHITECTURE.pdf` | Full backend + frontend + QA/eval architecture, synthesized from all 7 specialist agent personas |
| `agents/` | The seven agent personas (solution-architect, ai-engineer, fullstack-engineer, qa-engineer, product-manager, ui-designer, ux-designer) |
| `context.txt` | The original brief and constraints |
| `planning-agent-mock/` | Next.js 16 mock app with a working Kimi (Moonshot K2) integration |

## The mock app

A working end-to-end planning agent that follows the architecture:

- **Deterministic DSP gate** — pure-TS rules decide which (if any) DSPs are eligible before any LLM call
- **Deterministic capability retrieval** — structured filter against the in-repo catalog
- **LLM extraction** — `POST /api/extract` runs Kimi K2 to convert free-text briefs into the 11-field `Brief` object
- **LLM plan generation** — `POST /api/plans/generate` runs Kimi K2 with the catalog + DSP gate to produce structured plan lines
- **Deterministic validation** — schema, capability/deal resolution, share sums, justification rules, with one retry on failure

### Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · TypeScript · Zod · OpenAI SDK pointed at OpenRouter · `jsonrepair` for tolerant LLM-JSON parsing.

### Run locally

```bash
cd planning-agent-mock
npm install
cp .env.example .env.local
# Edit .env.local to set MOONSHOT_API_KEY (OpenRouter key works — Kimi is OpenAI-compatible)
npm run dev
```

Open http://localhost:3000, paste a brief, click "Draft plan."

### Env vars

```
MOONSHOT_API_KEY=sk-or-v1-...              # OpenRouter or Moonshot key
MOONSHOT_BASE_URL=https://openrouter.ai/api/v1
MOONSHOT_MODEL=moonshotai/kimi-k2-0905
```

Switch the base URL + model to use Moonshot direct, a free OpenRouter model, or any other OpenAI-compatible endpoint.
