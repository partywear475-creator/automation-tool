-- ===========================================================================
-- Automation Tool — Supabase schema
-- Run this in Supabase → SQL Editor (or `supabase db push`).
-- ===========================================================================

-- Every execution of a workflow, success or failure. This is your n8n
-- "Executions" tab.
create table if not exists public.workflow_runs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   text        not null,          -- e.g. 'cocogrove-storytelling-carousel'
  status        text        not null default 'running', -- running | success | error
  trigger       text        not null default 'cron',    -- cron | manual | api
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  steps         jsonb       not null default '[]'::jsonb, -- per-step log
  output        jsonb,                                      -- summary payload
  error         text
);

create index if not exists workflow_runs_workflow_idx
  on public.workflow_runs (workflow_id, started_at desc);

-- Small key/value store for anything a workflow needs to remember between runs
-- (last posted item, cursor, de-dupe keys, etc.). Replaces n8n static data.
create table if not exists public.workflow_state (
  workflow_id text        not null,
  key         text        not null,
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (workflow_id, key)
);

-- Row Level Security: the service role (server) bypasses RLS. The dashboard
-- uses the anon key and gets read-only access to run history.
alter table public.workflow_runs  enable row level security;
alter table public.workflow_state enable row level security;

drop policy if exists "runs readable by anon" on public.workflow_runs;
create policy "runs readable by anon"
  on public.workflow_runs for select
  to anon
  using (true);

-- workflow_state is server-only: no anon policy, so the anon key can't read it.
