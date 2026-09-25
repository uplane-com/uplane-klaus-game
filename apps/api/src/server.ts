import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { AgentEvent, EventBatch } from '@office/events';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { requireScope } from './auth';
import { sql } from './db';
import { env } from './env';
import { fromGithub, verifySignature } from './github';
import { ingest } from './ingest';
import { backfillLinear, fromLinear, isFresh, verifyLinear } from './linear';
import { migrate } from './migrate';
import { snapshot } from './snapshot';
import { Broadcaster } from './stream';
import { startSweeper } from './sweeper';

const broadcaster = new Broadcaster();
const app = new Hono();

app.use('/v1/*', cors({ origin: env.corsOrigins.length ? env.corsOrigins : '*', allowHeaders: ['authorization', 'content-type', 'last-event-id'] }));

/** Database setup state; the server listens right away and retries the DB until it works. */
let ready = false;
let bootError: string | null = null;

app.get('/health', async (c) => {
  if (env.missing.length) return c.json({ ok: false, error: `Missing environment variable(s): ${env.missing.join(', ')}` }, 503);
  if (!ready) return c.json({ ok: false, error: bootError ?? 'Connecting to the database…' }, 503);
  try {
    await sql`select 1`;
  } catch (err) {
    return c.json({ ok: false, error: `Database: ${err instanceof Error ? err.message : err}` }, 503);
  }
  return c.json({ ok: true, cursor: broadcaster.cursor, viewers: broadcaster.viewers });
});

/** Ingest a batch of events from agents (idempotent per event id). */
app.post('/v1/events', requireScope('write'), bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
  const parsed = EventBatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid batch', issues: z.treeifyError(parsed.error) }, 400);
  return c.json(await ingest(parsed.data.events));
});

/**
 * GitHub org webhook (workflow_job, deployment_status): every Actions job and
 * deployment becomes an agent. Authenticated by the webhook's HMAC signature.
 */
app.post('/v1/github', bodyLimit({ maxSize: 10 * 1024 * 1024 }), async (c) => {
  const secret = env.githubWebhookSecret;
  if (!secret) return c.json({ error: 'GITHUB_WEBHOOK_SECRET is not configured' }, 503);
  const body = await c.req.text();
  if (!verifySignature(secret, body, c.req.header('x-hub-signature-256'))) return c.json({ error: 'bad signature' }, 401);
  const kind = c.req.header('x-github-event') ?? '';
  if (kind === 'ping') return c.json({ ok: true });
  const delivery = c.req.header('x-github-delivery') ?? crypto.randomUUID();
  const events = await fromGithub(kind, delivery, JSON.parse(body));
  if (!events.length) return c.json({ accepted: 0, ignored: true });
  const parsed = EventBatch.safeParse({ events });
  if (!parsed.success) return c.json({ error: 'mapping produced invalid events', issues: z.treeifyError(parsed.error) }, 500);
  return c.json(await ingest(parsed.data.events));
});

/** Linear workspace webhook (resource type Issue) → the ticket wall. */
app.post('/v1/linear', bodyLimit({ maxSize: 5 * 1024 * 1024 }), async (c) => {
  const secret = env.linearWebhookSecret;
  if (!secret) return c.json({ error: 'LINEAR_WEBHOOK_SECRET is not configured' }, 503);
  const body = await c.req.text();
  if (!verifyLinear(secret, body, c.req.header('linear-signature'))) return c.json({ error: 'bad signature' }, 401);
  const payload = JSON.parse(body);
  if (!isFresh(payload.webhookTimestamp)) return c.json({ error: 'stale delivery' }, 400);
  const events = fromLinear(c.req.header('linear-event') ?? '', c.req.header('linear-delivery') ?? crypto.randomUUID(), payload);
  if (!events.length) return c.json({ accepted: 0, ignored: true });
  const parsed = EventBatch.safeParse({ events });
  if (!parsed.success) return c.json({ error: 'mapping produced invalid events', issues: z.treeifyError(parsed.error) }, 500);
  return c.json(await ingest(parsed.data.events));
});

/** Current office state + cursor to continue streaming from. */
app.get('/v1/snapshot', requireScope('read'), async (c) => c.json(await snapshot()));

/**
 * Live events as Server-Sent Events. Resumes from `?after=` or the
 * `Last-Event-ID` header; sends `resync` if the client fell too far behind.
 */
app.get('/v1/stream', requireScope('read'), (c) => {
  const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? broadcaster.cursor);
  return streamSSE(c, async (stream) => {
    let cursor = Number.isFinite(after) ? after : broadcaster.cursor;
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const send = (seq: number, event: AgentEvent) => {
      if (seq <= cursor) return;
      cursor = seq;
      queue.push(JSON.stringify({ seq, event }));
      wake?.();
    };

    const backlog = broadcaster.since(cursor);
    if (backlog === null) {
      await stream.writeSSE({ event: 'resync', data: '{}' });
      return;
    }
    for (const e of backlog) send(e.seq, e.event);
    const unsubscribe = broadcaster.subscribe((e) => send(e.seq, e.event));
    stream.onAbort(unsubscribe);

    while (!stream.aborted) {
      while (queue.length) {
        const data = queue.shift()!;
        await stream.writeSSE({ event: 'event', id: String(JSON.parse(data).seq), data });
      }
      // Wait for new events, or send a keep-alive every 15s.
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 15_000);
      });
      wake = null;
      if (!queue.length) await stream.writeSSE({ event: 'ping', data: '' });
    }
    unsubscribe();
  });
});

/** Raw event history for replays and analysis. */
app.get('/v1/events', requireScope('read'), async (c) => {
  const q = z
    .object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      agentId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    })
    .safeParse(c.req.query());
  if (!q.success) return c.json({ error: 'invalid query' }, 400);
  const { from, to, agentId, limit } = q.data;
  const rows = await sql<{ seq: string; event: AgentEvent }[]>`
    select id as seq, payload as event from events
    where true
      ${from ? sql`and ts >= ${from}` : sql``}
      ${to ? sql`and ts < ${to}` : sql``}
      ${agentId ? sql`and agent_id = ${agentId}` : sql``}
    order by id limit ${limit}`;
  return c.json({ events: rows.map((r) => ({ seq: Number(r.seq), event: r.event })) });
});

// The built visualisation (same origin as the API in production).
if (env.staticDir) {
  app.use('/*', serveStatic({ root: env.staticDir }));
  app.get('*', serveStatic({ root: env.staticDir, path: 'index.html' }));
}

serve({ fetch: app.fetch, port: env.port }, (info) => console.log(`office api listening on :${info.port}`));

// Migrate + start the live stream; keep retrying so a DB hiccup at boot doesn't take the app down.
async function boot() {
  if (env.missing.length) {
    console.error(`office api: missing environment variable(s) ${env.missing.join(', ')}; set them (fly secrets set ...) and restart`);
    return;
  }
  for (;;) {
    try {
      await migrate();
      await broadcaster.start();
      startSweeper();
      if (env.linearApiKey) {
        backfillLinear(env.linearApiKey)
          .then(async (events) => {
            const parsed = EventBatch.safeParse({ events: events.slice(0, 500) });
            if (parsed.success && events.length) console.log('linear backfill', await ingest(parsed.data.events));
          })
          .catch((err) => console.error('linear backfill failed', err));
      }
      ready = true;
      bootError = null;
      console.log('office api: database ready');
      return;
    } catch (err) {
      bootError = `Database setup failed: ${err instanceof Error ? err.message : err}`;
      console.error(`office api: ${bootError}; retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
void boot();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
