import { z } from 'zod';

/**
 * Event contract between agents and the office. Agents (via the SDK), the API
 * and the visualisation all use these schemas, so there is exactly one
 * definition of what an event looks like.
 */

export const RoleId = z.enum([
  'creative',
  'content',
  'adqa',
  'codegen',
  'codereview',
  'testing',
  'prreview',
  'comms',
  'statusmonitor',
  // GitHub Actions (via the /v1/github webhook).
  'cicheck',
  'deployer',
]);
export type RoleId = z.infer<typeof RoleId>;

export const PipelineId = z.enum(['ad', 'code', 'comms', 'ops']);
export type PipelineId = z.infer<typeof PipelineId>;

export const ToolId = z.enum([
  'web_search',
  'docs',
  'api',
  'database',
  'ci',
  'image_gen',
  'deploy',
  // Creative work, done in the Creative Studio.
  'brainstorm',
  'moodboard',
  'photo_shoot',
  'video_edit',
  // Recorded in the TV & Podcast studio.
  'podcast',
  'broadcast',
]);
export type ToolId = z.infer<typeof ToolId>;

const text = z.string().min(1).max(500);
const agentId = z.string().min(1).max(128);

export const Activity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('working') }),
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('tool'), tool: ToolId }),
  z.object({ kind: z.literal('blocked'), reason: text }),
  z.object({ kind: z.literal('error'), message: text }),
  z.object({ kind: z.literal('messaging'), with: text }),
  z.object({ kind: z.literal('meeting'), meetingId: z.string().min(1).max(128), topic: text }),
  z.object({ kind: z.literal('idle') }),
]);
export type Activity = z.infer<typeof Activity>;
export type ActivityKind = Activity['kind'];

export const TaskRef = z.object({
  id: z.string().min(1).max(128),
  title: text,
  pipeline: PipelineId,
  stage: RoleId,
});
export type TaskRef = z.infer<typeof TaskRef>;

export const AgentInfo = z.object({ id: agentId, name: z.string().min(1).max(120), role: RoleId });
export type AgentInfo = z.infer<typeof AgentInfo>;

export const SystemStatus = z.enum(['operational', 'degraded', 'outage']);
export type SystemStatus = z.infer<typeof SystemStatus>;

export const ServiceStatus = z.object({ name: z.string().min(1).max(120), status: SystemStatus });
export type ServiceStatus = z.infer<typeof ServiceStatus>;

/** A Linear ticket (issue) for the ticket wall. */
export const TicketStateType = z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']);
export type TicketStateType = z.infer<typeof TicketStateType>;

export const Ticket = z.object({
  id: z.string().min(1).max(128),
  /** Human key, e.g. "ENG-123". */
  key: z.string().min(1).max(32),
  title: text,
  stateName: z.string().min(1).max(80),
  stateType: TicketStateType,
  /** Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: z.number().int().min(0).max(4),
  team: z.string().max(32).optional(),
  assignee: z.string().max(120).optional(),
  url: z.string().max(500).optional(),
  /** Epoch ms of the last change. */
  updatedAt: z.number().int().nonnegative(),
});
export type Ticket = z.infer<typeof Ticket>;

/** Fields every event carries. `id` makes retries idempotent; `ts` is epoch ms. */
const base = {
  id: z.uuid().optional(),
  ts: z.number().int().nonnegative(),
};

/**
 * Stop the agent automatically if nothing else arrives within this many seconds
 * (replaces the default silence timeout). E.g. a CI job may run for hours without
 * events, while a failed check should leave after two minutes.
 */
const ttlSeconds = z.number().int().positive().max(86_400).optional();

export const AgentEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('agent.started'),
    agent: AgentInfo,
    /** Agent existed before the viewer connected (snapshot): appears at its desk. */
    alreadyRunning: z.boolean().optional(),
    ttlSeconds,
  }),
  z.object({ ...base, type: z.literal('agent.task_assigned'), agentId, task: TaskRef }),
  z.object({ ...base, type: z.literal('agent.activity'), agentId, activity: Activity, ttlSeconds }),
  z.object({ ...base, type: z.literal('agent.handoff'), fromId: agentId, toId: agentId, taskId: z.string().min(1).max(128), taskTitle: text }),
  z.object({ ...base, type: z.literal('agent.task_completed'), agentId, taskId: z.string().min(1).max(128) }),
  z.object({ ...base, type: z.literal('agent.heartbeat'), agentId }),
  z.object({ ...base, type: z.literal('agent.stopped'), agentId, reason: text.optional() }),
  z.object({ ...base, type: z.literal('ticket.upserted'), ticket: Ticket }),
  z.object({ ...base, type: z.literal('ticket.removed'), ticketId: z.string().min(1).max(128) }),
  z.object({
    ...base,
    type: z.literal('system.status'),
    status: SystemStatus,
    services: z.array(ServiceStatus).max(100),
    message: text.optional(),
    reportedBy: agentId.optional(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventType = AgentEvent['type'];

/** Batch accepted by `POST /v1/events`. */
export const EventBatch = z.object({ events: z.array(AgentEvent).min(1).max(500) });
export type EventBatch = z.infer<typeof EventBatch>;

/** Where the visualisation gets events from (the office API). */
export interface AgentEventSource {
  start(emit: (event: AgentEvent) => void): void | Promise<void>;
  stop(): void;
}
