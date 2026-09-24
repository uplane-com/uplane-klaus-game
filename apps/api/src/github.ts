import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentEvent, RoleId } from '@office/events';
import { sql } from './db';

/**
 * GitHub webhook → office events. Every Actions job becomes an agent: checks
 * work in the Testing room, deploy jobs and GitHub deployments go to the server
 * room. Failures show an error for two minutes, then the agent leaves.
 */

/** Jobs can run for up to 6 hours without sending anything in between. */
const JOB_TTL = 6 * 3600;
/** A failed check stays (red ❗, "needs a human") for this long. */
const FAILURE_TTL = 120;
const DEPLOY_TTL = 2 * 3600;
const DEPLOY_NAME = /deploy|release|publish|rollout/i;

export function verifySignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Deterministic UUID per delivery + step, so GitHub redeliveries are deduplicated. */
function eventId(delivery: string, n: number): string {
  const h = createHash('sha256').update(`${delivery}:${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Job {
  id: number;
  run_id: number;
  name: string;
  workflow_name?: string | null;
  head_branch?: string | null;
  status: string;
  conclusion: string | null;
}

interface Deployment {
  id: number;
  environment: string;
  ref: string;
}

/** Translate one webhook delivery into office events (possibly none). */
export async function fromGithub(kind: string, delivery: string, payload: Record<string, unknown>): Promise<AgentEvent[]> {
  const repo = (payload.repository as { name?: string } | undefined)?.name ?? 'repo';
  const now = Date.now();
  let n = 0;
  const ev = <T extends object>(e: T) => ({ ...e, id: eventId(delivery, n++), ts: now }) as unknown as AgentEvent;

  if (kind === 'workflow_job') {
    const action = payload.action as string;
    const job = payload.workflow_job as Job;
    const agentId = `gh-job-${job.id}`;
    const role: RoleId = DEPLOY_NAME.test(`${job.name} ${job.workflow_name ?? ''}`) ? 'deployer' : 'cicheck';
    const name = clip(`${repo} · ${job.name}`, 120);
    const title = clip(`${job.workflow_name ?? 'Workflow'} · ${job.name}${job.head_branch ? ` (${job.head_branch})` : ''}`, 500);
    const task = { id: `gh-run-${job.run_id}-${job.id}`, title, pipeline: role === 'deployer' ? 'ops' : 'code', stage: role } as const;
    const state = await agentState(agentId);

    if (action === 'queued' || action === 'waiting') {
      if (state) return []; // already here (or already finished)
      return [
        ev({ type: 'agent.started', agent: { id: agentId, name, role }, ttlSeconds: JOB_TTL }),
        ev({ type: 'agent.task_assigned', agentId, task }),
        ev({ type: 'agent.activity', agentId, activity: { kind: 'idle' }, ttlSeconds: JOB_TTL }),
      ];
    }
    if (action === 'in_progress') {
      if (state === 'stopped') return []; // completion arrived first
      const work = role === 'deployer' ? ({ kind: 'tool', tool: 'deploy' } as const) : ({ kind: 'working' } as const);
      return [
        ...(state ? [] : [ev({ type: 'agent.started', agent: { id: agentId, name, role }, ttlSeconds: JOB_TTL }), ev({ type: 'agent.task_assigned', agentId, task })]),
        ev({ type: 'agent.activity', agentId, activity: work, ttlSeconds: JOB_TTL }),
      ];
    }
    if (action === 'completed') {
      if (state === 'stopped') return [];
      const failed = job.conclusion === 'failure' || job.conclusion === 'timed_out' || job.conclusion === 'startup_failure';
      if (failed) {
        return [
          ...(state ? [] : [ev({ type: 'agent.started', agent: { id: agentId, name, role }, ttlSeconds: FAILURE_TTL }), ev({ type: 'agent.task_assigned', agentId, task })]),
          ev({ type: 'agent.activity', agentId, activity: { kind: 'error', message: clip(`${job.name} ${job.conclusion?.replace('_', ' ')}`, 500) }, ttlSeconds: FAILURE_TTL }),
        ];
      }
      if (!state) return []; // finished before we ever saw it: nothing to show
      return [
        ...(job.conclusion === 'success' ? [ev({ type: 'agent.task_completed', agentId, taskId: task.id })] : []),
        ev({ type: 'agent.stopped', agentId, reason: job.conclusion ?? 'completed' }),
      ];
    }
    return [];
  }

  if (kind === 'deployment_status') {
    const status = payload.deployment_status as { state: string; log_url?: string | null; target_url?: string | null; description?: string | null };
    // Deployments created by an Actions job (environment:) are already shown via that job.
    if (`${status.log_url ?? ''} ${status.target_url ?? ''}`.includes('/actions/runs/')) return [];
    const dep = payload.deployment as Deployment;
    const agentId = `gh-deploy-${dep.id}`;
    const name = clip(`${repo} → ${dep.environment}`, 120);
    const state = await agentState(agentId);
    const task = { id: `gh-deploy-${dep.id}`, title: clip(`Deploy ${dep.ref} to ${dep.environment}`, 500), pipeline: 'ops', stage: 'deployer' } as const;
    const s = status.state;
    if (s === 'queued' || s === 'pending' || s === 'in_progress') {
      if (state === 'stopped') return [];
      return [
        ...(state ? [] : [ev({ type: 'agent.started', agent: { id: agentId, name, role: 'deployer' }, ttlSeconds: DEPLOY_TTL }), ev({ type: 'agent.task_assigned', agentId, task })]),
        ev({ type: 'agent.activity', agentId, activity: { kind: 'tool', tool: 'deploy' }, ttlSeconds: DEPLOY_TTL }),
      ];
    }
    if (s === 'failure' || s === 'error') {
      if (state === 'stopped') return [];
      return [
        ...(state ? [] : [ev({ type: 'agent.started', agent: { id: agentId, name, role: 'deployer' }, ttlSeconds: FAILURE_TTL }), ev({ type: 'agent.task_assigned', agentId, task })]),
        ev({ type: 'agent.activity', agentId, activity: { kind: 'error', message: clip(status.description || `Deploy to ${dep.environment} failed`, 500) }, ttlSeconds: FAILURE_TTL }),
      ];
    }
    if ((s === 'success' || s === 'inactive') && state === 'active') {
      return [ev({ type: 'agent.task_completed', agentId, taskId: task.id }), ev({ type: 'agent.stopped', agentId, reason: s })];
    }
    return [];
  }

  return [];
}

async function agentState(id: string): Promise<'active' | 'stopped' | null> {
  const rows = await sql<{ status: 'active' | 'stopped' }[]>`select status from agents where id = ${id}`;
  return rows[0]?.status ?? null;
}
