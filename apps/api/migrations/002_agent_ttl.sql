-- Per-agent auto-stop time (from `ttlSeconds` on agent.started / agent.activity).
-- When set it replaces the default silence timeout for that agent.
alter table agents add column stop_at timestamptz;
create index agents_stop_at_idx on agents (stop_at) where status = 'active';
