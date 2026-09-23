import type { Activity, AgentEvent, AgentEventSource, RoleId, ServiceStatus, SystemStatus, TaskRef } from '@office/events';

interface Snapshot {
  cursor: number;
  agents: { id: string; name: string; role: RoleId; activity: Activity; task: TaskRef | null }[];
  system: { status: SystemStatus; services: ServiceStatus[]; message: string | null } | null;
}

/**
 * Live events from the office API: loads a snapshot (everyone already at
 * work appears at their desk), then follows `/v1/stream`. EventSource
 * reconnects on its own and resumes via Last-Event-ID.
 */
export type ConnectionState = 'connecting' | 'live' | 'offline';

export class ApiEventSource implements AgentEventSource {
  private es: EventSource | null = null;
  private cursor = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 0;
  private stopped = false;

  constructor(
    private readonly baseUrl: string,
    private readonly key: string | null,
    private readonly onState: (state: ConnectionState, detail?: string) => void = () => {},
  ) {}

  private url(path: string, params: Record<string, string> = {}) {
    const u = new URL(path, this.baseUrl);
    if (this.key) u.searchParams.set('key', this.key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  /** Never throws: an unreachable API shows an empty office and keeps retrying. */
  async start(emit: (event: AgentEvent) => void) {
    this.onState('connecting');
    let snap: Snapshot;
    try {
      const res = await fetch(this.url('/v1/snapshot'));
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      snap = (await res.json()) as Snapshot;
    } catch (err) {
      this.retryMs = Math.min(30_000, this.retryMs ? this.retryMs * 2 : 2_000);
      this.onState('offline', `Office API unreachable (${err instanceof Error ? err.message : err}), retrying…`);
      if (!this.stopped) this.retryTimer = setTimeout(() => void this.start(emit), this.retryMs);
      return;
    }
    this.retryMs = 0;
    const ts = Date.now();
    for (const a of snap.agents) {
      emit({ type: 'agent.started', ts, agent: { id: a.id, name: a.name, role: a.role }, alreadyRunning: true });
      if (a.task) emit({ type: 'agent.task_assigned', ts, agentId: a.id, task: a.task });
      emit({ type: 'agent.activity', ts, agentId: a.id, activity: a.activity });
    }
    if (snap.system) {
      emit({ type: 'system.status', ts, status: snap.system.status, services: snap.system.services, message: snap.system.message ?? undefined });
    }
    this.cursor = snap.cursor;

    this.es = new EventSource(this.url('/v1/stream', { after: String(snap.cursor) }));
    this.es.onopen = () => this.onState('live');
    this.es.onerror = () => this.onState('connecting', 'Reconnecting to the office API…');
    this.es.addEventListener('event', (m) => {
      const { seq, event } = JSON.parse((m as MessageEvent).data) as { seq: number; event: AgentEvent };
      if (seq <= this.cursor) return;
      this.cursor = seq;
      emit(event);
    });
    // Too far behind to catch up from the stream: start over from a fresh snapshot.
    this.es.addEventListener('resync', () => location.reload());
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.es?.close();
    this.es = null;
  }
}
