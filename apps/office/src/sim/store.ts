import { ROLES, TOOL_LABELS } from '@office/events';
import type { Activity, AgentEvent, RoleId, ServiceStatus, SystemStatus, TaskRef } from '@office/events';

/**
 * Pure data view of all agents, built only from events. Knows nothing about
 * rendering or movement — the Director reads it to decide where bodies go.
 */

export interface HistoryEntry {
  ts: number;
  text: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: RoleId;
  status: 'active' | 'stopped';
  activity: Activity;
  activitySince: number;
  task: TaskRef | null;
  tasksCompleted: number;
  startedAt: number;
  history: HistoryEntry[];
  /** Pending handoffs this agent must physically deliver. */
  deliveries: { toId: string; taskTitle: string }[];
}

export type StoreListener = (event: AgentEvent, record: AgentRecord | undefined) => void;

const MAX_HISTORY = 40;

export interface SystemState {
  status: SystemStatus;
  services: ServiceStatus[];
  message: string;
  since: number;
}

export class AgentStore {
  readonly agents = new Map<string, AgentRecord>();
  system: SystemState = { status: 'operational', services: [], message: '', since: 0 };
  private listeners = new Set<StoreListener>();

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(event: AgentEvent) {
    const now = performance.now();
    let rec: AgentRecord | undefined;
    switch (event.type) {
      case 'agent.started': {
        rec = {
          ...event.agent,
          status: 'active',
          activity: { kind: 'idle' },
          activitySince: now,
          task: null,
          tasksCompleted: 0,
          startedAt: now,
          history: [],
          deliveries: [],
        };
        this.agents.set(rec.id, rec);
        log(rec, `Started as ${ROLES[rec.role].label}`);
        break;
      }
      case 'agent.task_assigned': {
        rec = this.agents.get(event.agentId);
        if (!rec) return;
        rec.task = event.task;
        log(rec, `Picked up "${event.task.title}"`);
        break;
      }
      case 'agent.activity': {
        rec = this.agents.get(event.agentId);
        if (!rec) return;
        rec.activity = event.activity;
        rec.activitySince = now;
        log(rec, describeActivity(event.activity));
        break;
      }
      case 'agent.handoff': {
        rec = this.agents.get(event.fromId);
        const to = this.agents.get(event.toId);
        if (!rec) return;
        if (to) {
          rec.deliveries.push({ toId: to.id, taskTitle: event.taskTitle });
          log(rec, `Handing "${event.taskTitle}" to ${to.name}`);
          log(to, `Receiving "${event.taskTitle}" from ${rec.name}`);
        }
        break;
      }
      case 'agent.task_completed': {
        rec = this.agents.get(event.agentId);
        if (!rec) return;
        if (rec.task) log(rec, `Completed "${rec.task.title}"`);
        rec.task = null;
        rec.tasksCompleted++;
        break;
      }
      case 'system.status': {
        if (event.status !== this.system.status) this.system.since = now;
        this.system = { ...this.system, status: event.status, services: event.services, message: event.message ?? '' };
        break;
      }
      case 'agent.stopped': {
        rec = this.agents.get(event.agentId);
        if (!rec) return;
        rec.status = 'stopped';
        rec.activity = { kind: 'idle' };
        log(rec, `Stopped${event.reason ? ` (${event.reason})` : ''}`);
        break;
      }
    }
    for (const fn of this.listeners) fn(event, rec);
  }

  /** Called by the Director once a stopped agent has physically left. */
  remove(id: string) {
    this.agents.delete(id);
  }
}

function log(rec: AgentRecord, text: string) {
  rec.history.push({ ts: Date.now(), text });
  if (rec.history.length > MAX_HISTORY) rec.history.shift();
}

export function describeActivity(a: Activity): string {
  switch (a.kind) {
    case 'working':
      return 'Working';
    case 'thinking':
      return 'Thinking';
    case 'tool':
      return TOOL_LABELS[a.tool];
    case 'blocked':
      return `Waiting for human: ${a.reason}`;
    case 'error':
      return `Error: ${a.message}`;
    case 'messaging':
      return `Messaging ${a.with}`;
    case 'meeting':
      return `Meeting: ${a.topic}`;
    case 'idle':
      return 'Idle';
  }
}
