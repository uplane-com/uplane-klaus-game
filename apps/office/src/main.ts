import * as THREE from 'three';
import './style.css';
import type { AgentEventSource } from '@office/events';
import { ApiEventSource, type ConnectionState } from './api-source';
import { Navigation } from './nav/navigation';
import { loadFurniture } from './render/assets';
import { AlarmSystem } from './render/alarms';
import { Cinematics } from './render/cinematics';
import { Guards } from './render/guards';
import { SeatedStaff } from './render/seatedStaff';
import { Housekeeping } from './sim/housekeeping';
import { RobotVisitor } from './sim/robotVisitor';
import { SlidingDoors } from './render/slidingDoors';
import { Turnstiles } from './render/turnstiles';
import { Smoke } from './render/smoke';
import { CharacterLibrary } from './render/characters';
import { VehicleFactory } from './render/vehicles';
import { OfficeView, loadLogo } from './render/office';
import { Stage } from './render/stage';
import { Director } from './sim/director';
import { AgentStore } from './sim/store';
import { TransportSystem } from './sim/transport';
import { Hud } from './ui/hud';
import { buildLayout } from './world/layout';

async function main() {
  const app = document.getElementById('app')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Building the office…';
  app.appendChild(loading);

  // Uplane fonts are used in canvas textures (logo), so wait briefly for them.
  await Promise.race([document.fonts.load('500 64px "Lab Grotesque"').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  await loadLogo('brand/uplane_logo_horizontal.svg');

  const layout = buildLayout();
  const [nav, furniture, chars, vehicles] = await Promise.all([
    Navigation.create(layout),
    loadFurniture(),
    CharacterLibrary.load(),
    VehicleFactory.load(),
  ]);

  const stage = new Stage(app, new THREE.Vector3(35, 0, 42));
  const office = new OfficeView(layout, furniture);
  stage.scene.add(office.group);

  const alarms = new AlarmSystem(layout.alarms, stage.sun, stage.hemi);
  stage.scene.add(alarms.group);

  const store = new AgentStore();
  const director = new Director(store, layout, nav, chars, stage.scene, office);
  const transport = new TransportSystem(stage.scene, layout, vehicles, {
    alight: (id, pos, mode, slot) => director.alight(id, pos, mode, slot),
    character: (id) => director.characterInTransit(id),
    rideGone: (id) => director.rideGone(id),
  });
  director.attachTransport(transport);

  // Live data from the office API (?api=… / VITE_OFFICE_API, or the same origin when the
  // API serves the page). Without an API the office stays empty.
  const params = new URLSearchParams(location.search);
  const apiKey = params.get('key');
  const apiUrl = params.get('api') ?? import.meta.env.VITE_OFFICE_API ?? (import.meta.env.DEV ? null : location.origin);
  let connection: { state: ConnectionState; detail?: string } = { state: 'connecting' };
  let showConnection: ((state: ConnectionState, detail?: string) => void) | null = null;
  const onConnection = (state: ConnectionState, detail?: string) => {
    connection = { state, detail };
    showConnection?.(state, detail);
  };
  const source: AgentEventSource | null = apiUrl ? new ApiEventSource(apiUrl, apiKey, onConnection) : null;
  await source?.start((e) => store.apply(e));

  const guards = new Guards(stage.scene, chars, layout.guards);
  const reception = new SeatedStaff(stage.scene, (i) => chars.createReceptionist(i), layout.receptionists);
  // The server room is never unattended: one operator permanently holds a NOC seat.
  const nocSeat = layout.rooms.get('server')?.seats.find((s) => s.kind === 'desk');
  if (nocSeat) nocSeat.occupant = 'noc-operator';
  const operator = new SeatedStaff(stage.scene, () => chars.createOperator(), nocSeat ? [{ x: nocSeat.pos.x, z: nocSeat.pos.z, yaw: nocSeat.yaw }] : []);
  // Janitor + cleaner when the office is quiet.
  const housekeeping = new Housekeeping(stage.scene, chars, nav, layout, () => director.actors.size);
  // Occasionally a humanoid robot tours the office when it's quiet.
  const robot = new RobotVisitor(stage.scene, nav, layout, () => director.actors.size);
  // Automatic glass doors on the server room.
  const serverDoors = new SlidingDoors([...layout.rooms.values()].filter((r) => r.def.kind === 'server').flatMap((r) => r.doors));
  stage.scene.add(serverDoors.group);
  const people = function* () {
    for (const a of director.actors.values()) if (!a.riding) yield a.body;
  };
  const gates = layout.turnstiles ? new Turnstiles(layout.turnstiles) : null;
  if (gates) {
    stage.scene.add(gates.group);
    director.attachGates(gates);
  }
  const smoke = new Smoke(layout.racks);
  stage.scene.add(smoke.points);

  // TV mode: auto camera tour; picks a walking agent for the "follow" shot.
  const cinematics = new Cinematics(stage, () => {
    const walkers = [...director.actors.values()].filter((a) => a.body.phase === 'walking' && !a.riding);
    const a = walkers[Math.floor(Math.random() * walkers.length)];
    if (!a) return null;
    return () => (director.actors.has(a.id) && !a.riding ? new THREE.Vector3(a.body.x, 0, a.body.z) : null);
  }, (x0, z0, x1, z1) => {
    let n = 0;
    for (const a of director.actors.values()) if (!a.riding && a.body.x >= x0 && a.body.x <= x1 && a.body.z >= z0 && a.body.z <= z1) n++;
    return n;
  });

  const hud = new Hud(app, stage, director, store);
  if (!apiUrl) hud.setConnection('offline', 'No data source. Open with ?api=<url>&key=<key>.');
  else {
    hud.setConnection(connection.state, connection.detail);
    showConnection = (state, detail) => hud.setConnection(state, detail);
  }
  hud.onTvMode = (on) => {
    cinematics.enabled = on;
    if (on) {
      hud.follow = false;
      cinematics.restart();
    }
  };
  // ?kiosk hides the controls and event feed for wall displays.
  if (new URLSearchParams(location.search).has('kiosk')) document.body.classList.add('kiosk');
  loading.remove();

  // Debug handle for poking at the sim from the console.
  Object.assign(window, { office: { layout, nav, director, store, source, stage, chars, transport, housekeeping, robot, THREE, get cinematics() { return cinematics; } } });

  const timer = new THREE.Timer();
  let simTime = 0;
  const step = (dt: number) => {
    simTime += dt;
    transport.update(dt, simTime);
    nav.update(dt);
    const zoom = stage.camera.zoom;
    director.update(dt, THREE.MathUtils.clamp(18 + zoom * 9, 20, 46) * Math.min(window.devicePixelRatio, 2));
    office.update(dt);
    const incident = store.system.status !== 'operational';
    alarms.update(dt, incident, simTime);
    guards.update(dt, simTime, incident);
    reception.update(dt, simTime, incident);
    operator.update(dt, simTime, incident);
    housekeeping.update(dt, simTime);
    robot.update(dt, simTime);
    gates?.update(dt);
    serverDoors.update(dt, people());
    if (!hud.follow) cinematics.update(dt, incident);
    const canvasH = stage.renderer.domElement.clientHeight * Math.min(window.devicePixelRatio, 2);
    smoke.update(dt, incident, (canvasH * stage.camera.zoom) / (stage.camera.top - stage.camera.bottom));
    hud.update(dt);
  };
  const loop = (now?: number) => {
    timer.update(now);
    step(Math.min(timer.getDelta(), 1 / 20));
    stage.render();
    requestAnimationFrame(loop);
  };
  loop();
  // Debug: fast-forward the visualisation from the console, e.g. office.fastForward(10).
  Object.assign((window as unknown as { office: object }).office, {
    fastForward: (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30);
      stage.render();
    },
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('app')!.innerHTML = `<pre style="padding:20px;color:#b00">${String(err?.stack ?? err)}</pre>`;
});
