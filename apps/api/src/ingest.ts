import type { AgentEvent } from '@office/events';
import type { TransactionSql } from 'postgres';
import { NOTIFY_CHANNEL, sql } from './db';

const INGEST_LOCK = 7_413_001;

/**
 * Stores a batch of events and updates the current-state tables in one
 * transaction, then notifies stream listeners. Events whose `id` was already
 * stored are skipped (idempotent retries).
 */
export async function ingest(events: AgentEvent[]): Promise<{ accepted: number; duplicates: number }> {
  let accepted = 0;
  await sql.begin(async (tx) => {
    // Serialise writers so event ids become visible in order; otherwise a stream
    // reader could see id 11 commit before id 10 and skip 10 forever.
    await tx`select pg_advisory_xact_lock(${INGEST_LOCK})`;
    for (const raw of events) {
      const event = { ...raw, id: raw.id ?? crypto.randomUUID() };
      const rows = await tx<{ id: string }[]>`
        insert into events (event_id, ts, type, agent_id, payload)
        values (${event.id}, ${new Date(event.ts)}, ${event.type}, ${agentOf(event)}, ${tx.json(event as never)})
        on conflict (event_id) do nothing
        returning id`;
      if (!rows.length) continue;
      accepted++;
      await project(tx, event);
    }
    if (accepted) await tx`select pg_notify(${NOTIFY_CHANNEL}, '')`;
  });
  return { accepted, duplicates: events.length - accepted };
}

function agentOf(e: AgentEvent): string | null {
  switch (e.type) {
    case 'agent.started':
      return e.agent.id;
    case 'agent.handoff':
      return e.fromId;
    case 'system.status':
      return e.reportedBy ?? null;
    default:
      return e.agentId;
  }
}

/** Keeps `agents` / `system_status` in sync with the log. */
async function project(tx: TransactionSql, e: AgentEvent) {
  const ts = new Date(e.ts);
  switch (e.type) {
    case 'agent.started':
      await tx`
        insert into agents (id, name, role, status, activity, activity_since, task, started_at, stopped_at, last_seen_at)
        values (${e.agent.id}, ${e.agent.name}, ${e.agent.role}, 'active', '{"kind":"idle"}', ${ts}, null, ${ts}, null, ${ts})
        on conflict (id) do update set
          name = excluded.name, role = excluded.role, status = 'active', activity = excluded.activity,
          activity_since = excluded.activity_since, task = null, started_at = excluded.started_at,
          stopped_at = null, last_seen_at = excluded.last_seen_at`;
      break;
    case 'agent.task_assigned':
      await tx`update agents set task = ${tx.json(e.task)}, last_seen_at = ${ts} where id = ${e.agentId}`;
      break;
    case 'agent.activity':
      await tx`update agents set activity = ${tx.json(e.activity as never)}, activity_since = ${ts}, last_seen_at = ${ts} where id = ${e.agentId}`;
      break;
    case 'agent.task_completed':
      await tx`update agents set task = null, tasks_completed = tasks_completed + 1, last_seen_at = ${ts} where id = ${e.agentId}`;
      break;
    case 'agent.handoff':
      await tx`update agents set last_seen_at = ${ts} where id = ${e.fromId}`;
      break;
    case 'agent.heartbeat':
      await tx`update agents set last_seen_at = ${ts} where id = ${e.agentId}`;
      break;
    case 'agent.stopped':
      await tx`update agents set status = 'stopped', stopped_at = ${ts}, activity = '{"kind":"idle"}', last_seen_at = ${ts} where id = ${e.agentId}`;
      break;
    case 'system.status':
      await tx`
        insert into system_status (id, status, services, message, since, updated_at)
        values (1, ${e.status}, ${tx.json(e.services)}, ${e.message ?? null}, ${ts}, ${ts})
        on conflict (id) do update set
          since = case when system_status.status = excluded.status then system_status.since else excluded.since end,
          status = excluded.status, services = excluded.services, message = excluded.message, updated_at = excluded.updated_at`;
      break;
  }
}
