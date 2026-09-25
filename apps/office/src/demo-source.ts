import type { Activity, AgentEvent, AgentEventSource, RoleId, TaskRef, ToolId } from '@office/events';
import { Rng } from './util/rng';

/**
 * `?demo`: simulated Uplane agents on top of the real data, so the office always
 * has at least MIN_TOTAL characters. Runs only in this browser (nothing is sent
 * to the API). As real agents arrive, demo agents go home; there are no demo
 * incidents (alarms only come from real status events).
 */

const MIN_TOTAL = 100;
/** How many demo agents may arrive / leave per second when topping up. */
const ARRIVAL_RATE = 4;
const PREFIX = 'demo-';

const FIRST = ['Mia', 'Noah', 'Lena', 'Leo', 'Ava', 'Finn', 'Zoe', 'Liam', 'Ivy', 'Omar', 'Nora', 'Kai', 'Emma', 'Theo', 'Sara', 'Jonas', 'Maya', 'Elias', 'Lara', 'Ben', 'Chloe', 'Luca', 'Hana', 'Milo', 'Aria', 'Felix', 'Nia', 'Oscar', 'Yara', 'Emil'];
const LAST = 'ABCDEFGHJKLMNOPRSTVWZ';

const CLIENTS = ['Brightline Coffee', 'Nova Skincare', 'Peak Fitness', 'Harbor Hotels', 'Lumen Lighting', 'Fable Books', 'Kite Travel', 'Orbit Bikes', 'Sprout Kids', 'Atlas Insurance', 'Maple Home', 'Vivid Eyewear', 'Ember Grills', 'Tidal Swimwear'];
const CHANNELS = ['Meta', 'Google', 'TikTok'];
const OFFERS = ['summer sale', 'spring launch', 'free shipping week', 'new collection', 'holiday bundle', 'app install push', 'retargeting', 'lead gen'];

type Pipe = 'ad' | 'code' | 'comms';
const STAGES: Record<Pipe, RoleId[]> = {
  ad: ['creative', 'content', 'adqa'],
  code: ['codegen', 'codereview', 'testing', 'prreview'],
  comms: ['comms'],
};
/** How many agents per role (relative weights). */
const ROLE_WEIGHTS: Partial<Record<RoleId, number>> = { creative: 1.3, content: 1.1, adqa: 0.8, codegen: 1.1, codereview: 0.9, testing: 0.8, prreview: 0.5, comms: 0.9 };
const PIPE_OF: Partial<Record<RoleId, Pipe>> = { creative: 'ad', content: 'ad', adqa: 'ad', codegen: 'code', codereview: 'code', testing: 'code', prreview: 'code', comms: 'comms' };

const TOOLS: Record<Pipe, ToolId[]> = {
  ad: ['image_gen', 'image_gen', 'brainstorm', 'moodboard', 'photo_shoot', 'video_edit', 'web_search', 'api'],
  code: ['ci', 'ci', 'database', 'api', 'docs', 'web_search', 'deploy'],
  comms: ['web_search', 'docs', 'api', 'podcast', 'broadcast', 'brainstorm'],
};
/** Studio/media sessions take longer than a quick lookup. */
const LONG_TOOLS = new Set<ToolId>(['brainstorm', 'moodboard', 'photo_shoot', 'video_edit', 'podcast', 'broadcast']);

const BLOCKERS = ['Needs brand approval', 'Waiting for client assets', 'Budget cap reached — approve increase?', 'Legal review of claim', 'Ad account access expired', 'PR needs human sign-off'];
const ERRORS = ['Ad rejected by Meta policy', 'TikTok API rate limit', 'Landing page build failed', 'Flaky test: checkout flow', 'Creative export timed out'];
const PEOPLE = ['Klaus', 'Lukas', 'the account team', 'a client', 'design lead', 'growth team'];

interface DemoAgent {
  id: string;
  role: RoleId;
  pipe: Pipe;
  task: TaskRef | null;
  /** Seconds until the current activity ends. */
  left: number;
  /** Tasks to finish before going home. */
  shift: number;
  meeting: boolean;
}

export class DemoSource implements AgentEventSource {
  private emit: (e: AgentEvent) => void = () => {};
  private readonly rng = new Rng('uplane-demo');
  private readonly agents = new Map<string, DemoAgent>();
  private nextId = 1;
  private nextTask = 1;
  private arrivalBudget = 0;
  private meetingCooldown = 25;

  /** `realCount` = active agents that came from the API. */
  constructor(private readonly realCount: () => number) {}

  start(emit: (e: AgentEvent) => void) {
    this.emit = emit;
    // Start with part of the crowd already at work, the rest arrives over time.
    const initial = Math.max(0, Math.min(60, MIN_TOTAL - this.realCount()));
    for (let i = 0; i < initial; i++) this.spawn(true);
  }

  stop() {
    for (const id of [...this.agents.keys()]) this.leave(id, 'demo stopped');
  }

  get count() {
    return this.agents.size;
  }

  update(dt: number) {
    const want = Math.max(0, MIN_TOTAL - this.realCount());
    this.arrivalBudget = Math.min(ARRIVAL_RATE, this.arrivalBudget + dt * ARRIVAL_RATE);
    if (this.agents.size < want && this.arrivalBudget >= 1) {
      this.arrivalBudget -= 1;
      this.spawn(false);
    } else if (this.agents.size > want + (want > 0 ? 5 : 0) && this.arrivalBudget >= 1) {
      // (a little slack while topping up avoids churn; none once real agents alone reach the minimum)
      // Real agents took over: send someone without a task home.
      const idle = [...this.agents.values()].find((a) => !a.task && !a.meeting) ?? [...this.agents.values()][0];
      if (idle) {
        this.arrivalBudget -= 1;
        this.leave(idle.id, 'shift over');
      }
    }

    this.meetingCooldown -= dt;
    if (this.meetingCooldown <= 0) {
      this.meetingCooldown = this.rng.float(20, 45);
      this.startMeeting();
    }
    for (const a of [...this.agents.values()]) this.tick(a, dt);
  }

  // -- lifecycle --------------------------------------------------------------

  private spawn(alreadyRunning: boolean) {
    const role = this.rng.weighted(Object.keys(ROLE_WEIGHTS) as RoleId[], (r) => ROLE_WEIGHTS[r] ?? 0);
    const id = `${PREFIX}${this.nextId++}`;
    const name = `${this.rng.pick(FIRST)} ${LAST[this.rng.int(0, LAST.length - 1)]}.`;
    const a: DemoAgent = { id, role, pipe: PIPE_OF[role]!, task: null, left: this.rng.float(1, 4), shift: this.rng.int(3, 8), meeting: false };
    this.agents.set(id, a);
    this.send({ type: 'agent.started', agent: { id, name, role }, alreadyRunning });
    // Stage-one roles start their own work; later stages wait for a handoff (or pick up a review).
    if (STAGES[a.pipe][0] === role || this.rng.chance(0.5)) this.assign(a, this.newTask(a.pipe, role));
    else this.setActivity(a, { kind: 'idle' }, this.rng.float(4, 10));
  }

  private leave(id: string, reason: string) {
    if (!this.agents.delete(id)) return;
    this.send({ type: 'agent.stopped', agentId: id, reason });
  }

  // -- work -----------------------------------------------------------------------

  private tick(a: DemoAgent, dt: number) {
    a.left -= dt;
    if (a.left > 0) return;
    if (a.meeting) a.meeting = false;
    if (!a.task) {
      // Idle: go home after the shift, otherwise start something new.
      if (a.shift <= 0) return this.leave(a.id, 'shift over');
      if (STAGES[a.pipe][0] === a.role || this.rng.chance(0.35)) this.assign(a, this.newTask(a.pipe, a.role));
      else this.setActivity(a, { kind: 'idle' }, this.rng.float(6, 14));
      return;
    }
    const r = this.rng.float();
    if (r < 0.14) return this.finishStage(a);
    if (a.role === 'comms' && r < 0.4) return this.setActivity(a, { kind: 'messaging', with: this.rng.pick(PEOPLE) }, this.rng.float(8, 20));
    if (r < 0.45) return this.setActivity(a, { kind: 'working' }, this.rng.float(6, 16));
    if (r < 0.62) return this.setActivity(a, { kind: 'thinking' }, this.rng.float(3, 8));
    if (r < 0.88) {
      const tool = this.rng.pick(TOOLS[a.pipe]);
      return this.setActivity(a, { kind: 'tool', tool }, LONG_TOOLS.has(tool) ? this.rng.float(25, 45) : this.rng.float(5, 14));
    }
    if (r < 0.95) return this.setActivity(a, { kind: 'blocked', reason: this.rng.pick(BLOCKERS) }, this.rng.float(12, 30));
    this.setActivity(a, { kind: 'error', message: this.rng.pick(ERRORS) }, this.rng.float(3, 6));
  }

  /** Done with this stage: hand the task to the next role in the pipeline, or complete it. */
  private finishStage(a: DemoAgent) {
    const task = a.task!;
    const stages = STAGES[a.pipe];
    const next = stages[stages.indexOf(a.role) + 1];
    const receiver = next ? [...this.agents.values()].find((o) => o.role === next && !o.task && !o.meeting) : undefined;
    if (receiver) {
      this.send({ type: 'agent.handoff', fromId: a.id, toId: receiver.id, taskId: task.id, taskTitle: task.title });
      this.assign(receiver, { ...task, stage: next });
    }
    this.send({ type: 'agent.task_completed', agentId: a.id, taskId: task.id });
    a.task = null;
    a.shift--;
    this.setActivity(a, { kind: this.rng.chance(0.5) ? 'idle' : 'working' }, this.rng.float(4, 10));
  }

  private assign(a: DemoAgent, task: TaskRef) {
    a.task = task;
    this.send({ type: 'agent.task_assigned', agentId: a.id, task });
    this.setActivity(a, { kind: 'working' }, this.rng.float(6, 14));
  }

  private setActivity(a: DemoAgent, activity: Activity, seconds: number) {
    a.left = seconds;
    this.send({ type: 'agent.activity', agentId: a.id, activity });
  }

  /** A few agents of one pipeline get together (creative review, sprint sync, client prep). */
  private startMeeting() {
    const pipe = this.rng.pick(['ad', 'code', 'comms', 'ad'] as Pipe[]);
    const group = [...this.agents.values()].filter((a) => a.pipe === pipe && a.task && !a.meeting).slice(0, this.rng.int(3, 6));
    if (group.length < 3) return;
    const topic = this.rng.pick(
      pipe === 'ad'
        ? [`Creative review: ${this.rng.pick(CLIENTS)}`, 'Weekly ad performance', `Concepts for ${this.rng.pick(CLIENTS)}`]
        : pipe === 'code'
          ? ['Sprint sync', 'Incident review', 'Landing page builder planning']
          : ['Client update prep', 'Newsletter planning'],
    );
    const meetingId = `demo-meeting-${this.nextTask++}`;
    const seconds = this.rng.float(30, 60);
    for (const a of group) {
      a.meeting = true;
      this.setActivity(a, { kind: 'meeting', meetingId, topic }, seconds);
    }
  }

  private newTask(pipe: Pipe, role: RoleId): TaskRef {
    const client = this.rng.pick(CLIENTS);
    const channel = this.rng.pick(CHANNELS);
    const offer = this.rng.pick(OFFERS);
    const titles: Record<Pipe, string[]> = {
      ad: [
        `${channel} ads · ${offer} · ${client}`,
        `20 ${channel} ad variants for ${client}`,
        `Landing page · ${client} ${offer}`,
        `UGC-style ${channel === 'TikTok' ? 'TikTok' : 'Reels'} hooks · ${client}`,
        `Carousel creatives · ${client}`,
        `Refresh fatigued creatives · ${client}`,
      ],
      code: [
        `${channel} Ads API sync`,
        'Budget allocator: shift spend to top ad sets',
        'Landing page builder: hero variants',
        `${channel} conversions API integration`,
        'Creative renderer: faster video exports',
        'Dashboard: ROAS by channel',
        'Fix attribution window bug',
      ],
      comms: [
        `Weekly performance report · ${client}`,
        `Client update: ${channel} results · ${client}`,
        `Onboarding email · ${client}`,
        'Newsletter: what worked this week',
      ],
    };
    return { id: `demo-task-${this.nextTask++}`, title: this.rng.pick(titles[pipe]), pipeline: pipe, stage: role };
  }

  private send(e: object) {
    this.emit({ ...e, ts: Date.now() } as AgentEvent);
  }
}
