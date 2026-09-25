import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentEvent, Ticket, TicketStateType } from '@office/events';

/**
 * Linear webhook (resource type Issue) → ticket events for the ticket wall.
 * Plus an optional one-time backfill of open issues via the GraphQL API.
 */

/** Linear recommends rejecting deliveries older than a minute (replay protection). */
const MAX_AGE_MS = 60_000;
const STATE_TYPES = new Set<TicketStateType>(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']);

export function verifyLinear(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
  const got = Buffer.from(signature);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function isFresh(webhookTimestamp: unknown, now = Date.now()): boolean {
  return typeof webhookTimestamp === 'number' && Math.abs(now - webhookTimestamp) <= MAX_AGE_MS;
}

/** Deterministic UUID (same input → same id, so retries/backfills are deduplicated). */
function uuidFrom(input: string): string {
  const h = createHash('sha256').update(input).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface LinearIssue {
  id: string;
  identifier?: string;
  title?: string;
  priority?: number;
  url?: string;
  updatedAt?: string;
  state?: { name?: string; type?: string } | null;
  team?: { key?: string } | null;
  assignee?: { name?: string } | null;
}

function toTicket(issue: LinearIssue): Ticket | null {
  const type = issue.state?.type as TicketStateType | undefined;
  if (!issue.id || !issue.identifier || !issue.title || !type || !STATE_TYPES.has(type)) return null;
  return {
    id: issue.id,
    key: clip(issue.identifier, 32),
    title: clip(issue.title, 500),
    stateName: clip(issue.state?.name || type, 80),
    stateType: type,
    priority: Math.min(4, Math.max(0, Math.round(issue.priority ?? 0))),
    team: issue.team?.key ? clip(issue.team.key, 32) : undefined,
    assignee: issue.assignee?.name ? clip(issue.assignee.name, 120) : undefined,
    url: issue.url ? clip(issue.url, 500) : undefined,
    updatedAt: issue.updatedAt ? Date.parse(issue.updatedAt) : Date.now(),
  };
}

/** Map one webhook delivery. Only Issue events are used. */
export function fromLinear(kind: string, delivery: string, payload: { action?: string; type?: string; data?: LinearIssue }): AgentEvent[] {
  if ((payload.type ?? kind) !== 'Issue' || !payload.data?.id) return [];
  const id = uuidFrom(`linear:${delivery}`);
  const ts = Date.now();
  if (payload.action === 'remove') return [{ id, ts, type: 'ticket.removed', ticketId: payload.data.id }];
  const ticket = toTicket(payload.data);
  return ticket ? [{ id, ts, type: 'ticket.upserted', ticket }] : [];
}

/** Fetch open issues once (LINEAR_API_KEY) so the wall isn't empty until tickets change. */
export async function backfillLinear(apiKey: string): Promise<AgentEvent[]> {
  const query = `query Open($after: String) {
    issues(first: 100, after: $after, orderBy: updatedAt, filter: { state: { type: { in: ["triage", "unstarted", "started"] } } }) {
      nodes { id identifier title priority url updatedAt state { name type } team { key } assignee { name } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const events: AgentEvent[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: apiKey },
      body: JSON.stringify({ query, variables: { after } }),
    });
    if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: { issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: unknown };
    if (!json.data) throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
    for (const issue of json.data.issues.nodes) {
      const ticket = toTicket(issue);
      if (ticket) events.push({ id: uuidFrom(`linear-backfill:${ticket.id}:${ticket.updatedAt}`), ts: Date.now(), type: 'ticket.upserted', ticket });
    }
    if (!json.data.issues.pageInfo.hasNextPage) break;
    after = json.data.issues.pageInfo.endCursor;
  }
  return events;
}
