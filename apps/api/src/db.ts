import postgres from 'postgres';
import { env } from './env';

const ssl = (url: string) => (/sslmode=(require|verify)/.test(url) || url.includes('neon.tech') ? 'require' : undefined);

/**
 * Query pool. Neon's pooled endpoint runs PgBouncer in transaction mode, so
 * prepared statements are disabled.
 */
// postgres() connects lazily, so a placeholder URL is fine until DATABASE_URL is set.
const PLACEHOLDER = 'postgres://unset@127.0.0.1:1/unset';

export const sql = postgres(env.databaseUrl || PLACEHOLDER, {
  ssl: ssl(env.databaseUrl),
  max: 10,
  prepare: false,
  idle_timeout: 30,
  onnotice: () => {},
});

/** Dedicated direct connection for LISTEN/NOTIFY (not possible through PgBouncer). */
export const listener = postgres(env.databaseUrlUnpooled || PLACEHOLDER, {
  ssl: ssl(env.databaseUrlUnpooled),
  max: 1,
  onnotice: () => {},
});

export const NOTIFY_CHANNEL = 'office_events';
