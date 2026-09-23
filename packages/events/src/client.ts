import type { Activity, AgentEvent, AgentInfo, ServiceStatus, SystemStatus, TaskRef, ToolId } from './schema';

/**
 * Tiny SDK for agents: `emit()` queues events, which are sent in batches to
 * `POST /v1/events`. Every event gets a UUID so retries are idempotent.
 *
 *   const office = new OfficeClient({ url: 'https://office.fly.dev', apiKey: process.env.OFFICE_KEY! });
 *   const me = office.agent({ id: 'agent-42', name: 'Mia', role: 'codegen' });
 *   me.started();
 *   me.task({ id: 't1', title: 'Fix login', pipeline: 'code', stage: 'codegen' });
 *   me.tool('ci');
 *   me.stopped('done');
 */

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type EventInput = DistributiveOmit<AgentEvent, 'id' | 'ts'> & { id?: string; ts?: number };

export interface OfficeClientOptions {
  /** Base URL of the office API, e.g. https://uplane-office.fly.dev */
  url: string;
  /** API key with the `write` scope. */
  apiKey: string;
  /** How long to collect events before sending (default 250 ms). */
  flushIntervalMs?: number;
  /** Max events per request (default 200, server limit 500). */
  maxBatch?: number;
  /** Drop the oldest events beyond this queue size while the API is unreachable (default 10k). */
  maxQueue?: number;
  onError?: (error: unknown) => void;
  fetch?: typeof fetch;
}

export class OfficeClient {
  private readonly queue: AgentEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> | null = null;
  private backoffMs = 0;
  private readonly opts: Required<Omit<OfficeClientOptions, 'onError' | 'fetch'>> & Pick<OfficeClientOptions, 'onError'> & { fetch: typeof fetch };

  constructor(options: OfficeClientOptions) {
    this.opts = {
      flushIntervalMs: 250,
      maxBatch: 200,
      maxQueue: 10_000,
      fetch: globalThis.fetch.bind(globalThis),
      ...options,
      url: options.url.replace(/\/$/, ''),
    };
  }

  emit(event: EventInput): void {
    this.queue.push({ ...event, id: event.id ?? crypto.randomUUID(), ts: event.ts ?? Date.now() } as AgentEvent);
    if (this.queue.length > this.opts.maxQueue) this.queue.splice(0, this.queue.length - this.opts.maxQueue);
    this.schedule(this.queue.length >= this.opts.maxBatch ? 0 : this.opts.flushIntervalMs);
  }

  /** Convenience wrapper bound to one agent. */
  agent(info: AgentInfo) {
    const agentId = info.id;
    const activity = (a: Activity) => this.emit({ type: 'agent.activity', agentId, activity: a });
    return {
      started: () => this.emit({ type: 'agent.started', agent: info }),
      task: (task: TaskRef) => this.emit({ type: 'agent.task_assigned', agentId, task }),
      completed: (taskId: string) => this.emit({ type: 'agent.task_completed', agentId, taskId }),
      handoff: (toId: string, task: Pick<TaskRef, 'id' | 'title'>) =>
        this.emit({ type: 'agent.handoff', fromId: agentId, toId, taskId: task.id, taskTitle: task.title }),
      activity,
      working: () => activity({ kind: 'working' }),
      thinking: () => activity({ kind: 'thinking' }),
      tool: (tool: ToolId) => activity({ kind: 'tool', tool }),
      blocked: (reason: string) => activity({ kind: 'blocked', reason }),
      error: (message: string) => activity({ kind: 'error', message }),
      messaging: (withWhom: string) => activity({ kind: 'messaging', with: withWhom }),
      idle: () => activity({ kind: 'idle' }),
      heartbeat: () => this.emit({ type: 'agent.heartbeat', agentId }),
      stopped: (reason?: string) => this.emit({ type: 'agent.stopped', agentId, reason }),
    };
  }

  /** Report the result of a status-page check. */
  systemStatus(status: SystemStatus, services: ServiceStatus[], message?: string, reportedBy?: string) {
    this.emit({ type: 'system.status', status, services, message, reportedBy });
  }

  /** Send everything that is queued. Resolves when the queue is empty or the API is unreachable. */
  async flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.drain().finally(() => (this.sending = null));
    return this.sending;
  }

  /** Flush and stop the timer (call on shutdown). */
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }

  private schedule(delay: number) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(delay, this.backoffMs));
  }

  private async drain() {
    while (this.queue.length) {
      const batch = this.queue.slice(0, this.opts.maxBatch);
      let res: Response;
      try {
        res = await this.opts.fetch(`${this.opts.url}/v1/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
          body: JSON.stringify({ events: batch }),
        });
      } catch (err) {
        this.retryLater(err);
        return;
      }
      if (res.ok) {
        this.queue.splice(0, batch.length);
        this.backoffMs = 0;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        this.retryLater(new Error(`office API ${res.status}`));
        return;
      }
      // Client error (bad payload/auth): retrying won't help, drop the batch.
      this.queue.splice(0, batch.length);
      this.opts.onError?.(new Error(`office API rejected batch: ${res.status} ${await res.text().catch(() => '')}`));
    }
  }

  private retryLater(err: unknown) {
    this.backoffMs = Math.min(30_000, this.backoffMs ? this.backoffMs * 2 : 500);
    this.opts.onError?.(err);
    this.schedule(this.backoffMs);
  }
}
