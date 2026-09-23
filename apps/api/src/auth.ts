import { createHash, randomBytes } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { sql } from './db';
import { env } from './env';

export type Scope = 'write' | 'read' | 'admin';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function generateKey(): string {
  return `ofc_${randomBytes(24).toString('base64url')}`;
}

// Small in-memory cache so every event batch doesn't hit the keys table.
const cache = new Map<string, { scopes: Scope[]; until: number }>();

async function scopesFor(key: string): Promise<Scope[] | null> {
  const hash = hashKey(key);
  const hit = cache.get(hash);
  if (hit && hit.until > Date.now()) return hit.scopes;
  const rows = await sql<{ id: string; scopes: Scope[] }[]>`
    select id, scopes from api_keys where key_hash = ${hash} and revoked_at is null`;
  const scopes = rows[0]?.scopes ?? null;
  cache.set(hash, { scopes: scopes ?? [], until: Date.now() + 60_000 });
  if (rows[0]) void sql`update api_keys set last_used_at = now() where id = ${rows[0].id}`.catch(() => {});
  return scopes;
}

/**
 * Requires an API key with `scope` (admin keys may do everything). The key
 * comes from `Authorization: Bearer …` or, for EventSource/TV URLs, `?key=`.
 */
export const requireScope =
  (scope: Scope): MiddlewareHandler =>
  async (c, next) => {
    if (scope === 'read' && env.publicRead) return next();
    const header = c.req.header('authorization');
    const key = header?.startsWith('Bearer ') ? header.slice(7) : c.req.query('key');
    if (!key) return c.json({ error: 'missing API key' }, 401);
    const scopes = await scopesFor(key);
    if (!scopes || !(scopes.includes(scope) || scopes.includes('admin'))) return c.json({ error: 'forbidden' }, 403);
    return next();
  };
