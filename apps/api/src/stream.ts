import type { AgentEvent } from '@office/events';
import { listener, NOTIFY_CHANNEL, sql } from './db';

export interface StoredEvent {
  /** Stream cursor (events.id). */
  seq: number;
  event: AgentEvent;
}

type Subscriber = (e: StoredEvent) => void;

const RING_SIZE = 5000;
const POLL_MS = 2000;

/**
 * Tails the events table and fans new events out to connected viewers.
 * Woken by Postgres NOTIFY after each ingest, with a slow poll as a safety net.
 * Keeps the most recent events in memory so reconnecting clients can catch up
 * without touching the database.
 */
export class Broadcaster {
  private lastSeq = 0;
  private readonly ring: StoredEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private fetching: Promise<void> | null = null;
  private again = false;

  async start() {
    const recent = await sql<{ id: string; payload: AgentEvent }[]>`
      select id, payload from events order by id desc limit ${RING_SIZE}`;
    for (const r of recent.reverse()) this.push({ seq: Number(r.id), event: r.payload });
    const [{ max }] = await sql<{ max: string | null }[]>`select max(id) as max from events`;
    this.lastSeq = Number(max ?? 0);
    await listener.listen(NOTIFY_CHANNEL, () => void this.pull());
    setInterval(() => void this.pull(), POLL_MS).unref();
  }

  get cursor() {
    return this.lastSeq;
  }

  get viewers() {
    return this.subscribers.size;
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /**
   * Events after `after`, from memory when possible. Returns null if the
   * client is too far behind and should reload a fresh snapshot instead.
   */
  since(after: number): StoredEvent[] | null {
    if (after >= this.lastSeq) return [];
    const first = this.ring[0]?.seq ?? this.lastSeq + 1;
    if (after < first - 1) return null;
    return this.ring.filter((e) => e.seq > after);
  }

  private push(e: StoredEvent) {
    this.ring.push(e);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
  }

  /** Fetch everything newer than lastSeq (coalescing concurrent wake-ups). */
  private pull(): Promise<void> {
    if (this.fetching) {
      this.again = true;
      return this.fetching;
    }
    this.fetching = (async () => {
      do {
        this.again = false;
        const rows = await sql<{ id: string; payload: AgentEvent }[]>`
          select id, payload from events where id > ${this.lastSeq} order by id limit 1000`;
        for (const r of rows) {
          const e = { seq: Number(r.id), event: r.payload };
          this.lastSeq = e.seq;
          this.push(e);
          for (const fn of this.subscribers) fn(e);
        }
        if (rows.length === 1000) this.again = true;
      } while (this.again);
    })()
      .catch((err) => console.error('broadcast pull failed', err))
      .finally(() => (this.fetching = null));
    return this.fetching;
  }
}
