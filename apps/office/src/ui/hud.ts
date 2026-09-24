import * as THREE from 'three';
import { DEPTS, ROLES, TOOL_LABELS, type DeptId } from '@office/events';
import type { AgentEvent } from '@office/events';
import type { Stage } from '../render/stage';
import type { Actor, Director } from '../sim/director';
import { describeActivity, type AgentStore } from '../sim/store';

/** Plain DOM overlay: stats, controls, inspector, event feed and name labels. */
export class Hud {
  selected: Actor | null = null;
  hovered: Actor | null = null;
  follow = false;
  showNames = false;
  onTvMode?: (on: boolean) => void;

  private readonly root: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly inspectorEl: HTMLElement;
  private readonly feedEl: HTMLElement;
  private readonly perfEl: HTMLElement;
  private readonly incidentEl: HTMLElement;
  private readonly labelLayer: HTMLElement;
  private readonly labels: HTMLElement[] = [];
  private readonly feed: string[] = [];
  private statsTimer = 0;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(
    container: HTMLElement,
    private readonly stage: Stage,
    private readonly director: Director,
    private readonly store: AgentStore,
  ) {
    this.root = el('div', 'hud');
    container.appendChild(this.root);

    const top = el('div', 'panel top-left');
    top.innerHTML = `<div class="head"><img class="logo" src="brand/uplane_logo_horizontal.svg" alt="uplane" /><span class="sub">Agent Office</span><span class="system-slot"></span></div>`;
    this.statsEl = el('div', 'stats');
    top.appendChild(this.statsEl);
    this.root.appendChild(top);

    this.root.appendChild(this.buildControls());

    this.incidentEl = el('div', 'incident');
    this.root.appendChild(this.incidentEl);

    this.inspectorEl = el('div', 'panel inspector hidden');
    this.root.appendChild(this.inspectorEl);

    const feedPanel = el('div', 'panel feed');
    feedPanel.innerHTML = '<div class="section">Live events</div>';
    this.feedEl = el('div', 'feed-list');
    feedPanel.appendChild(this.feedEl);
    this.root.appendChild(feedPanel);

    this.perfEl = el('div', 'perf');
    this.root.appendChild(this.perfEl);

    this.labelLayer = el('div', 'labels');
    container.appendChild(this.labelLayer);

    store.subscribe((e) => this.onEvent(e));
    this.bindPointer();
  }

  /** SF local time + sun/moon, shown in the header. */
  setClock(text: string) {
    let el = this.root.querySelector<HTMLElement>('.clock-chip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'panel clock-chip';
      this.root.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }

  /** Shows whether live data is flowing (or why not). */
  setConnection(state: 'connecting' | 'live' | 'offline', detail?: string) {
    const badge = this.root.querySelector<HTMLElement>('#conn-badge');
    const text = this.root.querySelector<HTMLElement>('#conn-detail');
    if (badge) {
      badge.textContent = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting…' : 'Offline';
      badge.dataset.state = state;
    }
    if (text) {
      text.hidden = state === 'live' || !detail;
      text.textContent = detail ?? '';
    }
  }

  private buildControls(): HTMLElement {
    const p = el('div', 'panel controls');
    const live = `<div class="section">Live data <span class="badge" id="conn-badge">API</span></div>
      <div class="conn-detail" id="conn-detail" hidden></div>`;
    p.innerHTML = `${live}
      <div class="section">View</div>
      <label class="check"><input id="tv" type="checkbox" checked /> TV mode (auto camera)</label>
      <label class="check"><input id="names" type="checkbox" /> Show names</label>
      <label class="check"><input id="shadows" type="checkbox" checked /> Shadows</label>
    `;
    this.bindViewControls(p);
    return p;
  }

  private bindViewControls(p: HTMLElement) {
    p.querySelector<HTMLInputElement>('#tv')!.addEventListener('change', (e) => {
      this.onTvMode?.((e.target as HTMLInputElement).checked);
    });
    p.querySelector<HTMLInputElement>('#names')!.addEventListener('change', (e) => {
      this.showNames = (e.target as HTMLInputElement).checked;
    });
    p.querySelector<HTMLInputElement>('#shadows')!.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.stage.renderer.shadowMap.enabled = on;
      this.stage.refreshShadows();
      this.stage.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    });
  }

  /** Called with the floor point under the pointer (null when off the scene). */
  onGroundHover: ((x: number | null, z: number | null) => void) | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly groundHit = new THREE.Vector3();

  private bindPointer() {
    const canvas = this.stage.renderer.domElement;
    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, w: r.width, h: r.height };
    };
    let downAt = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      const p = ndc(e);
      this.select(this.director.pick(this.stage.camera, p.x, p.y, p.w, p.h));
    });
    let last = 0;
    canvas.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      const p = ndc(e);
      this.hovered = this.director.pick(this.stage.camera, p.x, p.y, p.w, p.h);
      canvas.style.cursor = this.hovered ? 'pointer' : '';
      // Where on the floor is the pointer? (room hover signs)
      this.raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), this.stage.camera);
      const hit = this.raycaster.ray.intersectPlane(this.ground, this.groundHit);
      this.onGroundHover?.(hit ? hit.x : null, hit ? hit.z : null);
    });
    canvas.addEventListener('pointerleave', () => this.onGroundHover?.(null, null));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
      if (e.key === 'f' && this.selected) this.follow = !this.follow;
    });
  }

  select(a: Actor | null) {
    this.selected = a;
    if (!a) this.follow = false;
    this.inspectorEl.classList.toggle('hidden', !a);
    this.renderInspector();
  }

  private onEvent(e: AgentEvent) {
    const name = (id: string) => this.store.agents.get(id)?.name ?? id;
    let line: string | null = null;
    switch (e.type) {
      case 'agent.started':
        line = `👋 <b>${e.agent.name}</b> joined ${ROLES[e.agent.role].label}`;
        break;
      case 'agent.handoff':
        line = `📨 <b>${name(e.fromId)}</b> → <b>${name(e.toId)}</b>: ${e.taskTitle}`;
        break;
      case 'agent.task_completed':
        line = `✅ <b>${name(e.agentId)}</b> finished a task`;
        break;
      case 'agent.activity':
        if (e.activity.kind === 'blocked') line = `✋ <b>${name(e.agentId)}</b>: ${e.activity.reason}`;
        else if (e.activity.kind === 'error') line = `❗ <b>${name(e.agentId)}</b>: ${e.activity.message}`;
        break;
      case 'agent.stopped':
        line = `🚪 <b>${name(e.agentId)}</b> left`;
        break;
      case 'system.status':
        line = e.status === 'operational' ? `🟢 <b>Status page</b>: ${e.message ?? 'All systems operational'}` : `🚨 <b>Incident</b>: ${e.message ?? e.status}`;
        break;
    }
    if (!line) return;
    this.feed.unshift(line);
    if (this.feed.length > 9) this.feed.pop();
    this.feedEl.innerHTML = this.feed.map((l) => `<div>${l}</div>`).join('');
  }

  private renderIncident() {
    const sys = this.store.system;
    const show = sys.status !== 'operational';
    this.incidentEl.classList.toggle('show', show);
    if (!show) return;
    const secs = Math.floor((performance.now() - sys.since) / 1000);
    const label = sys.status === 'outage' ? 'Outage' : 'Degraded';
    this.incidentEl.innerHTML = `<span class="siren">🚨</span>${label} · ${sys.message}<time>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</time>`;
  }

  update(dt: number) {
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
      const info = this.stage.renderer.info.render;
      this.perfEl.textContent = `${this.fps.toFixed(0)} fps · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
    }

    if (this.selected && !this.director.actors.has(this.selected.id)) this.select(null);

    this.statsTimer -= dt;
    if (this.statsTimer <= 0) {
      this.statsTimer = 0.4;
      this.renderStats();
      this.renderInspector();
      this.renderIncident();
    }

    const rings = this.director.rings.selection;
    if (this.selected) {
      rings.visible = true;
      rings.position.set(this.selected.body.x, 0.05, this.selected.body.z);
      if (this.follow) this.stage.focus(this.selected.body.x, this.selected.body.z, 4, dt);
    } else rings.visible = false;

    this.renderLabels();
  }

  private renderStats() {
    const counts: Record<string, number> = { working: 0, thinking: 0, tool: 0, blocked: 0, error: 0, meeting: 0, messaging: 0, idle: 0 };
    const depts: Record<DeptId, number> = { ad: 0, eng: 0, comms: 0 };
    let active = 0;
    for (const a of this.director.actors.values()) {
      if (a.rec.status !== 'active') continue;
      active++;
      counts[a.rec.activity.kind]++;
      depts[ROLES[a.rec.role].dept]++;
    }
    const sys = this.store.system;
    const ok = sys.status === 'operational';
    const arriving = this.director.arrivingCount;
    const attention = counts.blocked + counts.error;
    const segments: [string, number, string][] = [
      ['Working', counts.working + counts.messaging, '#1a44ff'],
      ['Thinking', counts.thinking, '#8b7cf6'],
      ['Tools', counts.tool, '#2bb5c4'],
      ['Meeting', counts.meeting, '#f15bb5'],
      ['Blocked', counts.blocked, '#f5a524'],
      ['Error', counts.error, '#e5383b'],
      ['Idle', counts.idle, '#cfc9bd'],
    ];
    this.statsEl.innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${active}</b><span>In office</span></div>
        <div class="kpi"><b>${arriving}</b><span>Arriving</span></div>
        <div class="kpi ${attention ? 'warn' : ''}"><b>${attention}</b><span>Need a human</span></div>
      </div>
      <div class="bar">${segments
        .filter(([, n]) => n > 0)
        .map(([label, n, c]) => `<i style="flex:${n};background:${c}" title="${label}: ${n}"></i>`)
        .join('')}</div>
      <div class="bar-key">${segments
        .map(([label, n, c]) => `<span><i class="dot" style="background:${c}"></i>${label} <b>${n}</b></span>`)
        .join('')}</div>
      <div class="foot">
        <div class="depts">${(Object.keys(depts) as DeptId[])
          .map((d) => `<span><i class="dot" style="background:${DEPTS[d].color}"></i>${DEPTS[d].label} <b>${depts[d]}</b></span>`)
          .join('')}</div>
      </div>`;
    const slot = this.root.querySelector('.system-slot');
    if (slot) slot.innerHTML = `<span class="system ${ok ? '' : 'bad'}"><i></i>${ok ? 'All systems operational' : sys.message}</span>`;
  }

  private renderInspector() {
    const a = this.selected;
    if (!a) return;
    const rec = a.rec;
    const role = ROLES[rec.role];
    const dept = DEPTS[role.dept];
    const up = Math.round((performance.now() - rec.startedAt) / 1000);
    const act = rec.activity;
    const actText = act.kind === 'tool' ? `🔧 ${TOOL_LABELS[act.tool]}` : describeActivity(act);
    this.inspectorEl.innerHTML = `
      <div class="insp-head">
        <div>
          <div class="insp-name">${rec.name}</div>
          <div class="insp-role"><i class="dot" style="background:${dept.color}"></i>${role.label} · ${dept.label}</div>
        </div>
        <button class="close" data-close>×</button>
      </div>
      <div class="kv"><span>Status</span><b>${rec.status === 'stopped' ? 'Leaving' : actText}</b></div>
      <div class="kv"><span>Task</span><b>${rec.task ? rec.task.title : '—'}</b></div>
      <div class="kv"><span>Location</span><b>${this.director.locationOf(a)}</b></div>
      <div class="kv"><span>Desk</span><b>${a.desk ? a.desk.roomId : '—'}</b></div>
      <div class="kv"><span>Completed</span><b>${rec.tasksCompleted}</b></div>
      <div class="kv"><span>Online</span><b>${Math.floor(up / 60)}m ${up % 60}s</b></div>
      <button class="follow ${this.follow ? 'on' : ''}" data-follow>${this.follow ? 'Following (F)' : 'Follow (F)'}</button>
      <div class="section">History</div>
      <div class="history">${rec.history
        .slice()
        .reverse()
        .map((h) => `<div><time>${new Date(h.ts).toLocaleTimeString()}</time>${h.text}</div>`)
        .join('')}</div>`;
    this.inspectorEl.querySelector('[data-close]')!.addEventListener('click', () => this.select(null));
    this.inspectorEl.querySelector('[data-follow]')!.addEventListener('click', () => {
      this.follow = !this.follow;
      this.renderInspector();
    });
  }

  private renderLabels() {
    const cam = this.stage.camera;
    const canvas = this.stage.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const shown: Actor[] = [];
    if (this.selected) shown.push(this.selected);
    if (this.hovered && this.hovered !== this.selected) shown.push(this.hovered);
    if (this.showNames && cam.zoom > 1.6) {
      for (const a of this.director.actors.values()) {
        if (shown.length >= 90) break;
        if (a !== this.selected && a !== this.hovered) shown.push(a);
      }
    }
    const v = new THREE.Vector3();
    let i = 0;
    for (const a of shown) {
      v.set(a.body.x, a.body.y + 2.6, a.body.z).project(cam);
      if (v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      let lab = this.labels[i];
      if (!lab) {
        lab = el('div', 'label');
        this.labelLayer.appendChild(lab);
        this.labels.push(lab);
      }
      const text = `${a.rec.name} · ${ROLES[a.rec.role].label}`;
      if (lab.textContent !== text) lab.textContent = text;
      lab.style.display = '';
      lab.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      lab.classList.toggle('strong', a === this.selected || a === this.hovered);
      i++;
    }
    for (; i < this.labels.length; i++) this.labels[i].style.display = 'none';
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
