/** Runtime configuration (see .env.example). */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  databaseUrlUnpooled: process.env.DATABASE_URL_UNPOOLED || required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 8080),
  staleAfterSeconds: Number(process.env.STALE_AFTER_SECONDS ?? 900),
  publicRead: process.env.PUBLIC_READ === 'true',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: process.env.STATIC_DIR || null,
};
