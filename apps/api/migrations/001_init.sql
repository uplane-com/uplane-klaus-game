-- Append-only log of everything that happened. `id` is the stream cursor.
create table events (
  id          bigserial primary key,
  event_id    uuid not null unique,          -- sender-generated, makes retries idempotent
  ts          timestamptz not null,          -- when it happened (sender clock)
  received_at timestamptz not null default now(),
  type        text not null,
  agent_id    text,
  payload     jsonb not null
);
create index events_agent_idx on events (agent_id, id);
create index events_ts_idx on events (ts);

-- Current state per agent, projected from events in the same transaction.
create table agents (
  id               text primary key,
  name             text not null,
  role             text not null,
  status           text not null check (status in ('active', 'stopped')),
  activity         jsonb not null default '{"kind":"idle"}',
  activity_since   timestamptz,
  task             jsonb,
  tasks_completed  integer not null default 0,
  started_at       timestamptz not null,
  stopped_at       timestamptz,
  last_seen_at     timestamptz not null
);
create index agents_active_idx on agents (status, last_seen_at);

-- Latest status-page result (single row).
create table system_status (
  id       smallint primary key default 1 check (id = 1),
  status   text not null,
  services jsonb not null default '[]',
  message  text,
  since    timestamptz not null,
  updated_at timestamptz not null
);

-- API keys are stored as SHA-256 hashes only.
create table api_keys (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  key_hash    text not null unique,
  scopes      text[] not null,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);
