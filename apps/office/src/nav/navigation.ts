import { Crowd, NavMeshQuery, init, type CrowdAgent, type NavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { AGENT_HEIGHT, AGENT_RADIUS } from '../config/scale';
import type { Vec2 } from '../util/math';
import type { Box, OfficeLayout } from '../world/layout';

/**
 * Navmesh + Detour crowd. The crowd gives us pathfinding plus local
 * avoidance (RVO-style) so hundreds of agents steer around each other and
 * queue at doors instead of overlapping.
 */

const CS = 0.15;
const CH = 0.1;

export const MAX_AGENTS = 320;

/** DT_CROWD_ANTICIPATE_TURNS | OBSTACLE_AVOIDANCE | SEPARATION | OPTIMIZE_VIS | OPTIMIZE_TOPO */
const UPDATE_FLAGS = 1 | 2 | 4 | 8 | 16;

export class Navigation {
  private constructor(
    readonly navMesh: NavMesh,
    readonly query: NavMeshQuery,
    readonly crowd: Crowd,
  ) {}

  static async create(layout: OfficeLayout): Promise<Navigation> {
    await init();
    const { positions, indices } = buildNavInput(layout);
    const result = generateSoloNavMesh(positions, indices, {
      cs: CS,
      ch: CH,
      walkableHeight: Math.ceil(AGENT_HEIGHT / CH),
      walkableClimb: Math.floor(0.3 / CH),
      walkableRadius: Math.ceil(AGENT_RADIUS / CS),
      maxEdgeLen: Math.round(12 / CS),
      maxSimplificationError: 1.1,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!result.success) throw new Error(`Navmesh generation failed: ${result.error}`);
    const navMesh = result.navMesh;
    const query = new NavMeshQuery(navMesh);
    const crowd = new Crowd(navMesh, { maxAgents: MAX_AGENTS, maxAgentRadius: AGENT_RADIUS * 1.5 });
    return new Navigation(navMesh, query, crowd);
  }

  /** Snap a floor point onto the navmesh (ignores disconnected obstacle tops). */
  closest(p: Vec2): Vec2 {
    const res = this.query.findClosestPoint({ x: p.x, y: 0, z: p.z }, { halfExtents: { x: 3, y: 0.4, z: 3 } });
    if (!res.success) return p;
    return { x: res.point.x, z: res.point.z };
  }

  addAgent(p: Vec2, maxSpeed: number): CrowdAgent {
    const snapped = this.closest(p);
    return this.crowd.addAgent(
      { x: snapped.x, y: 0, z: snapped.z },
      {
        radius: AGENT_RADIUS,
        height: AGENT_HEIGHT,
        maxAcceleration: 10,
        maxSpeed,
        collisionQueryRange: AGENT_RADIUS * 10,
        pathOptimizationRange: AGENT_RADIUS * 40,
        separationWeight: 1.2,
        updateFlags: UPDATE_FLAGS,
        obstacleAvoidanceType: 3,
      },
    );
  }

  /** People heading home: faster, and comfortable with a denser crowd. */
  setHurry(agent: CrowdAgent, maxSpeed: number) {
    agent.updateParameters({ maxSpeed, radius: AGENT_RADIUS * 0.8, separationWeight: 0.6, maxAcceleration: 14 });
  }

  /** Temporarily shrink an agent so it can squeeze through a jam (and back). */
  setSqueezed(agent: CrowdAgent, squeezed: boolean) {
    agent.updateParameters(
      squeezed ? { radius: AGENT_RADIUS * 0.45, separationWeight: 0.2 } : { radius: AGENT_RADIUS, separationWeight: 1.2 },
    );
  }

  removeAgent(agent: CrowdAgent) {
    this.crowd.removeAgent(agent);
  }

  update(dt: number) {
    this.crowd.update(dt);
  }
}

function buildNavInput(layout: OfficeLayout) {
  const positions: number[] = [];
  const indices: number[] = [];
  const { x0, z0, x1, z1 } = layout.bounds;

  // One big floor quad.
  positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
  indices.push(0, 2, 1, 0, 3, 2);

  const addBox = (b: Box) => {
    const base = positions.length / 3;
    const hx = b.w / 2;
    const hz = b.d / 2;
    const y0 = b.y ?? 0;
    const y1 = y0 + b.h;
    const corners = [
      [b.x - hx, b.z - hz],
      [b.x + hx, b.z - hz],
      [b.x + hx, b.z + hz],
      [b.x - hx, b.z + hz],
    ];
    for (const [cx, cz] of corners) positions.push(cx, y0, cz);
    for (const [cx, cz] of corners) positions.push(cx, y1, cz);
    // top
    indices.push(base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
    // sides
    for (let i = 0; i < 4; i++) {
      const a = base + i;
      const b2 = base + ((i + 1) % 4);
      indices.push(a, b2, b2 + 4, a, b2 + 4, a + 4);
    }
  };
  for (const b of layout.obstacles) addBox(b);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
