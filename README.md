# uplane-klaus-game — Agent Office

A live, game-like 3D view of our AI agents at work (three.js). Agents arrive by
car, bus, bike, scooter or helicopter, walk to their desk, work, visit the
library/server room/Creative Studio for tool calls, hand work to each other, hold meetings,
take coffee breaks and leave again. An incident on the status page turns on
office-wide red alert beacons.

The office shows live data from the office API only; without it the office stays empty.

```sh
pnpm install
pnpm dev        # http://localhost:5173/?api=http://localhost:8080&key=<read key>
pnpm build
```

Monorepo:

| Package | What |
| --- | --- |
| `apps/office` | three.js visualisation (Vite) |
| `apps/api` | Hono API on Node: ingest, snapshot, live stream (SSE), Neon Postgres |
| `packages/events` | Event schemas (zod), roles and the agent SDK (`OfficeClient`) |

Controls: drag to pan, right-drag to rotate, scroll to zoom, click an agent to
inspect it (`F` follows, `Esc` closes).

## Architecture

```
AgentEventSource ──events──▶ AgentStore ──▶ Director ──▶ Body (crowd + animation)
 (office API)           (pure data)    (decides where    │
                                             agents go)        ▼
                                           TransportSystem   three.js scene / HUD
```

| Path | What |
| --- | --- |
| `packages/events/src/schema.ts` | **Event contract** (`agent.started`, `agent.activity`, `agent.handoff`, `system.status`, …). A real backend only needs to produce these. |
| `apps/office/src/sim/store.ts` | Agent records built purely from events. |
| `apps/office/src/sim/director.ts` | Maps agent state to behaviour: desks, tool trips, handoffs, meetings, breaks, arrivals/departures. |
| `apps/office/src/sim/body.ts` | Movement via Detour crowd (pathfinding + avoidance), sitting, fading. |
| `apps/office/src/sim/transport.ts` | Street traffic: drop-offs/pick-ups, bike rack, helicopter. |
| `apps/office/src/nav/navigation.ts` | Recast navmesh + crowd (`recast-navigation`). |
| `apps/office/src/config/office.ts` | Floor plan (rooms, doors). Room contents are generated from the room kind. |
| `packages/events/src/roles.ts` | Roles, departments, pipelines, tool → room mapping. |
| `apps/office/src/world/layout.ts` | Turns the config into walls, furniture, seats, spots, obstacles. |
| `apps/office/src/render/*` | Office, characters (per-agent variety), vehicles, overlays, alarms. |
| `apps/office/src/ui/hud.ts` | HUD in Uplane style. |

## Backend (apps/api)

```
agents ──(SDK) POST /v1/events──▶ API ──▶ Neon Postgres (events log + agents/system_status state)
TVs ◀── GET /v1/snapshot + GET /v1/stream (SSE) ──┘   (NOTIFY wakes the stream, 2s poll as safety net)
```

| Endpoint | Scope | |
| --- | --- | --- |
| `POST /v1/events` | write | Batch of events (max 500). Idempotent per event `id`. |
| `GET /v1/snapshot` | read | Active agents + system status + `cursor`. |
| `GET /v1/stream?after=<cursor>` | read | Server-Sent Events; resumes with `Last-Event-ID`. |
| `GET /v1/events?from&to&agentId` | read | History for replays / analysis. |
| `GET /health` | – | Liveness + current cursor. |

Keys are sent as `Authorization: Bearer <key>` (or `?key=` for TV URLs). Agents that
send nothing for `STALE_AFTER_SECONDS` are marked stopped automatically.

### Sending events from an agent

```ts
import { OfficeClient } from '@office/events';

const office = new OfficeClient({ url: 'https://uplane-office.fly.dev', apiKey: process.env.OFFICE_KEY! });
const me = office.agent({ id: runId, name: 'Mia', role: 'codegen' });
me.started();
me.task({ id: 'task-1', title: 'Fix login redirect', pipeline: 'code', stage: 'codegen' });
me.thinking();
me.tool('ci');            // creative: brainstorm, moodboard, photo_shoot, video_edit, image_gen; media: podcast, broadcast
me.handoff('agent-17', { id: 'task-1', title: 'Fix login redirect' });
me.stopped('done');
await office.close(); // flush on shutdown
```

Long idle periods: call `me.heartbeat()` every few minutes so the agent isn't timed out.

### Local development

```sh
cp apps/api/.env.example apps/api/.env      # point DATABASE_URL at Neon or a local Postgres
pnpm --filter @office/api migrate
pnpm --filter @office/api keys create agents write
pnpm --filter @office/api keys create tv read
pnpm dev:api                                 # :8080
# open http://localhost:5173/?api=http://localhost:8080&key=<read key>
```

### Deploy to Fly.io

```sh
fly launch --no-deploy --copy-config
fly secrets set DATABASE_URL='<neon pooled url>' DATABASE_URL_UNPOOLED='<neon direct url>'
fly deploy
fly ssh console -C "node_modules/.bin/tsx scripts/keys.ts create tv read"
```

The API serves the visualisation too, so a TV only needs
`https://uplane-office.fly.dev/?key=<read key>&kiosk`.

## Assets

- Characters, furniture, cars: [Kenney](https://kenney.nl) (CC0) — see license files in `apps/office/public/models/*`.
- Uplane logo and fonts belong to Uplane; fonts are loaded from uplane.com.
