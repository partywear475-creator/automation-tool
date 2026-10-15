# Automation Tool

A coded-workflow automation runner that **replaces n8n**. Each n8n workflow is
ported to a self-contained TypeScript module, triggered by **Vercel Cron**
(scheduled) or an authenticated HTTP endpoint (on-demand), with run logging and
a dashboard backed by **Supabase**.

Built to cut the recurring n8n hosting / gateway cost: the only running cost
here is Vercel + Supabase (both have usable free tiers) plus the per-call API
costs you already pay (OpenAI, Meta, etc.).

---

## How it maps to n8n

| n8n concept | Here |
|---|---|
| Workflow | A module in `src/workflows/<brand>/<slug>.ts` exporting `defineWorkflow({...})` |
| Node | Plain TypeScript using a shared lib in `src/lib/*` |
| Schedule trigger | `schedule` (cron, UTC) in the module + an entry in `vercel.json` |
| Manual / form trigger | `POST /api/workflows/<id>/run` with a JSON body |
| Executions tab | The dashboard (`/`) + the `workflow_runs` table in Supabase |
| Static data | `getState` / `setState` (the `workflow_state` table) |
| Credentials | Environment variables (see `.env.example`) |

**15 of the original workflows shared the same Graph API publish logic** — here
that lives once in `src/lib/instagram.ts`, and each workflow is thin config over
it. Reports, the Square sales pull, Cloudinary re-upload, email and Sheets are
likewise single shared libs.

---

## Architecture

```
src/
  lib/            shared primitives (the "nodes")
    instagram.ts    Graph API: page token, account guard, image/carousel/reel publish, insights, business discovery
    cloudinary.ts   re-upload hop -> JPEG URL (IG rejects some source PNGs)
    openai.ts       gpt-image-1 + gpt-4o/gpt-5-mini text/JSON
    gemini.ts       Google Gemini (Ember Wolf)
    square.ts       Orders search + roll-up (daily sales report)
    sheets.ts       Google Sheets append (service-account JWT)
    email.ts        Resend
    logger.ts       run + step logging, getState/setState
    run.ts          executes a workflow with logging (used by every trigger)
    env.ts          typed env access
  workflows/
    <brand>/<slug>.ts   one file per workflow
    registry.ts         the list of all workflows
    types.ts            the defineWorkflow contract
  app/
    page.tsx                      dashboard
    api/cron/[workflow]/route.ts  Vercel Cron entrypoint (Bearer CRON_SECRET)
    api/workflows/[workflow]/run  manual trigger (Bearer CRON_SECRET)
supabase/schema.sql   run the SQL once to create the tables
scripts/run-workflow.ts   local CLI to test a workflow
```

---

## Setup

1. **Supabase** — create a project, open the SQL editor, run `supabase/schema.sql`.
   Create a public storage bucket named `automation-assets` (or whatever you set
   `SUPABASE_STORAGE_BUCKET` to).
2. **Env** — copy `.env.example` → `.env.local`, fill it in. At minimum:
   `CRON_SECRET`, the three Supabase keys, `OPENAI_API_KEY`, `IG_ACCESS_TOKEN`,
   `CLOUDINARY_*`, `RESEND_API_KEY`. The rest are per-workflow (see the table).
3. **Install & run** — `npm install`, then `npm run dev` → open `http://localhost:3000`.
4. **Test a workflow locally** — `npm run run:workflow -- <id>` (e.g.
   `npm run run:workflow -- cocogrove-daily-sales-report`). Run with no id to
   list them.
5. **Deploy** — push to GitHub, import into Vercel, add the same env vars, deploy.
   `vercel.json` registers the cron schedules automatically.

### Triggering workflows

- **Scheduled** — Vercel Cron calls `GET /api/cron/<id>` on the schedule in
  `vercel.json`. It must send `Authorization: Bearer $CRON_SECRET` (Vercel does
  this for you).
- **On-demand** — `POST /api/workflows/<id>/run` with the same Bearer header and
  an optional JSON body (becomes the workflow's `ctx.input`). Example:
  ```bash
  curl -X POST https://<app>/api/workflows/cocogrove-caption-assistant/run \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"dishName":"Kerala prawn roast","postType":"feed"}'
  ```

> **Vercel plan note:** Cron on the **Hobby** plan is limited (daily granularity,
> max 2 jobs). This project defines **7** scheduled jobs → you need the **Pro**
> plan for all of them to run as written, or thin the schedule.

---

## Migrated workflows (17)

All ports are **faithful** — same steps, guards, schedules, prompts and captions
as the n8n source. Schedules shown in **UTC** (converted from the n8n
Europe/London times; October = BST = UTC+1).

| Workflow | New ID | Trigger | Schedule (UTC) | n8n ID |
|---|---|---|---|---|
| CocoGrove Storytelling Carousel | `cocogrove-storytelling-carousel` | schedule | `0 8 * * *` (09:00 London) | 9Pdt1dsLYfaAWmVu |
| CocoGrove Caption Assistant | `cocogrove-caption-assistant` | form | — | MKsFybxzjq1qGpjR |
| CocoGrove Instagram Performance Report | `cocogrove-instagram-performance-report` | schedule | `0 7 * * 1` (Mon 08:00) | DaGlIP6gzIXuBqem |
| CocoGrove Daily Sales Report | `cocogrove-daily-sales-report` | schedule | `0 7 * * *` (08:00) | cz9B1NwEDee7MmCC |
| Tixuy — Publish csraoul Posts | `tixuy-publish-csraoul` | manual | — | efe1lRM0obXwOp5c |
| Tixuy Realistic Avatar Post | `tixuy-realistic-avatar-post` | manual | — | 4GiwRSStByEzDrDQ |
| Tixuy Reel — Trending Music | `tixuy-reel-trending-music` | manual | — | h3zwpQQBNZGOPykE |
| Tixuy Instagram Carousel Post | `tixuy-instagram-carousel-post` | manual | — | pWpa8Pw5NlMM6q36 |
| Tixuy Auto-Post Carousel (Algo-Optimized) | `tixuy-instagram-auto-post-carousel` | schedule | `0 8 * * *` (09:00) | MnFx1dOnPB9wQgTq |
| Nia Nova — Approved FB/IG Reels | `nianova-approved-reels` | manual | — | DkITYpHDJ475cEU9 |
| Nia Nova — Instagram Auto-Post | `nianova-instagram-auto-post` | form | — | qMK2IAiZx0NWGOTP |
| Nia Nova — Daily TikTok Content Brief | `nianova-daily-tiktok-brief` | schedule | `0 8 * * *` (09:00) | MrMYNyT1swfeUqkA |
| Sorrel & Pip — Instagram Carousel | `sorrelpip-instagram-carousel` | manual | — | pe29cLrjfNZRH4xW |
| essiby Video Post (IG + FB) | `essiby-video-post` | manual | — | zAy6GS8NApAHWTPC |
| The Ember Wolf — Episode Generator | `emberwolf-episode-generator` | form | — | IocFtPmkY0VyzZl8 |
| Instagram Performance Report & Growth Insights | `shared-instagram-performance-report` | schedule | `0 7 * * 1` (Mon 08:00) | rfh4r5q2LxwBriAN |
| Instagram Competitor & Trend Tracker | `shared-instagram-competitor-trend-tracker` | schedule | `0 7 * * 3` (Wed 08:00) | NInolCmDZ8sG1APr |

### Not migrated (by design)

- **4 dated one-offs** (already-published single posts): Cocogrove approved Reel
  11 Oct, Cocogrove manual test 8 Oct, Nia Nova Hotel Arrival Reel 6 Oct, Nia
  Nova Studio Carousel 2 Oct. These were one-time publishes, not recurring jobs.
- **"Claude MCP Server"** — that's the n8n node exposing the MCP connection, not
  an automation.

---

## Known gaps — needs your input

Faithful porting surfaced a few things the coded version **cannot do fully on
its own**, because the original n8n workflow leaned on an external tool with no
API, or on a hop a shared lib doesn't yet cover. None of these block the other
workflows; each is isolated.

1. **External video/image generation has no API.** Where n8n expected a
   Higgsfield / Veo asset, the coded workflow takes the media **URL via
   `ctx.input`** instead of generating it, with a fallback to the last known
   asset. Affects: `tixuy-reel-trending-music`, `nianova-approved-reels` (reel
   video), and the Higgsfield cost-quote step in `nianova-daily-tiktok-brief`
   (skipped — no spend authorised, same as n8n). → *Decide how you want to feed
   generated video in: upload URL in the request body, or wire a generation API.*
2. **Facebook Reel upload in `nianova-approved-reels`** used a custom
   `rupload.facebook.com` two-phase upload with a templated credential. It's
   **gated off** (`publish_facebook=false`); IG publishing works. → *Tell me if
   you still post Reels to the FB Page and I'll port that upload.*
3. **Report "top post" links are blank.** The Graph reads don't request
   `permalink`, so `TopPostLink` in the two performance reports and the
   competitor tracker is empty. → *One-line lib change if you want the links back.*
4. **CocoGrove Storytelling Carousel prompt.** The n8n node contained a generic
   "Kerala roots → Eastbourne" prompt (live, ported verbatim) **and** a newer
   nested "weekly specials" variant that the n8n agent node did **not** actually
   read. If the weekly-specials version was meant to be live, say so and I'll
   swap it in.
5. **Tixuy Auto-Post dedupe** checks *live Instagram* for "already posted today"
   (faithful), but the n8n node also read a Google Sheet of past topics;
   `sheets.ts` is append-only so sheet history isn't consulted. Add a Sheets read
   helper if you want full topic-history dedupe.
6. **Two workflows were inactive in n8n** (`cocogrove-daily-sales-report`,
   `cocogrove-storytelling-carousel`) but are set `enabled: true` here to match
   the others. Set `enabled: false` in the module if they should stay dormant.
7. **Graph API version standardised to `v23.0`** (n8n had a mix of v21–v25). Set
   `GRAPH_API_VERSION` if a specific workflow needs a different one.

---

## Switching off n8n

Once you've verified a workflow here (run it manually, check the dashboard):
deactivate its n8n counterpart. Keep the n8n export JSON as a backup until
you've seen a full cycle of the scheduled jobs run green. The original n8n IDs
are in the table and in each module's `n8nId` field for traceability.
