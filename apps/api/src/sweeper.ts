import { sql } from './db';
import { env } from './env';
import { ingest } from './ingest';

/**
 * Agents that crash never send `agent.stopped`. Anything silent for longer than
 * STALE_AFTER_SECONDS is stopped here, so it walks out of the office.
 */
export function startSweeper() {
  const run = async () => {
    const stale = await sql<{ id: string }[]>`
      select id from agents
      where status = 'active' and last_seen_at < now() - make_interval(secs => ${env.staleAfterSeconds})
      limit 200`;
    if (!stale.length) return;
    await ingest(stale.map((a) => ({ type: 'agent.stopped' as const, agentId: a.id, reason: 'no activity (timeout)', ts: Date.now() })));
    console.log(`sweeper stopped ${stale.length} silent agents`);
  };
  setInterval(() => run().catch((err) => console.error('sweeper failed', err)), 30_000).unref();
}
