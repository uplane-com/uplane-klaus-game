import type { Activity, RoleId, ServiceStatus, SystemStatus, TaskRef, Ticket } from '@office/events';
import { sql } from './db';

export interface Snapshot {
  /** Stream from here: GET /v1/stream?after=<cursor>. */
  cursor: number;
  agents: {
    id: string;
    name: string;
    role: RoleId;
    activity: Activity;
    task: TaskRef | null;
    tasksCompleted: number;
    startedAt: string;
  }[];
  system: { status: SystemStatus; services: ServiceStatus[]; message: string | null; since: string } | null;
  /** Open Linear tickets + those finished in the last 24h (newest first, max 200). */
  tickets: Ticket[];
}

/** Current state of the office, consistent with the returned cursor. */
export async function snapshot(): Promise<Snapshot> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const [{ cursor }] = await tx<{ cursor: string | null }[]>`select max(id) as cursor from events`;
    const agents = await tx<Snapshot['agents']>`
      select id, name, role, activity, task, tasks_completed as "tasksCompleted", started_at as "startedAt"
      from agents where status = 'active' order by started_at`;
    const [system] = await tx<NonNullable<Snapshot['system']>[]>`
      select status, services, message, since from system_status where id = 1`;
    const tickets = await tx<(Omit<Ticket, 'updatedAt' | 'team' | 'assignee' | 'url'> & { updatedAt: Date; team: string | null; assignee: string | null; url: string | null })[]>`
      select id, key, title, state_name as "stateName", state_type as "stateType", priority, team, assignee, url, updated_at as "updatedAt"
      from tickets
      where state_type <> 'canceled' and (state_type <> 'completed' or updated_at > now() - interval '24 hours')
      order by updated_at desc limit 200`;
    return {
      cursor: Number(cursor ?? 0),
      agents: [...agents],
      system: system ?? null,
      tickets: tickets.map((t) => ({
        ...t,
        updatedAt: t.updatedAt.getTime(),
        team: t.team ?? undefined,
        assignee: t.assignee ?? undefined,
        url: t.url ?? undefined,
      })),
    };
  });
}
