/**
 * Manage API keys.
 *   pnpm keys create <name> [scopes=write]   e.g. `pnpm keys create tv-lobby read`
 *   pnpm keys list
 *   pnpm keys revoke <id>
 */
import { generateKey, hashKey } from '../src/auth';
import { sql } from '../src/db';
import { migrate } from '../src/migrate';

const [cmd, a, b] = process.argv.slice(2);
await migrate();
if (cmd === 'create' && a) {
  const scopes = (b ?? 'write').split(',');
  const key = generateKey();
  const [row] = await sql`insert into api_keys (name, key_hash, scopes) values (${a}, ${hashKey(key)}, ${scopes}) returning id`;
  console.log(`created key ${row.id} (${a}, scopes: ${scopes.join(',')})\n\n  ${key}\n\nStore it now, it is not shown again.`);
} else if (cmd === 'list') {
  console.table(await sql`select id, name, scopes, created_at, last_used_at, revoked_at from api_keys order by created_at`);
} else if (cmd === 'revoke' && a) {
  await sql`update api_keys set revoked_at = now() where id = ${a}`;
  console.log(`revoked ${a}`);
} else {
  console.log('usage: keys create <name> [scopes] | keys list | keys revoke <id>');
}
await sql.end();
