/** Runtime configuration (see .env.example). */
// Missing settings don't crash the process: the server still starts and /health says what's wrong.
const databaseUrl = process.env.DATABASE_URL ?? '';

export const env = {
  databaseUrl,
  databaseUrlUnpooled: process.env.DATABASE_URL_UNPOOLED || databaseUrl,
  /** Configuration problems reported by /health. */
  missing: databaseUrl ? [] : ['DATABASE_URL'],
  port: Number(process.env.PORT ?? 8080),
  staleAfterSeconds: Number(process.env.STALE_AFTER_SECONDS ?? 900),
  publicRead: process.env.PUBLIC_READ === 'true',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: process.env.STATIC_DIR || null,
};
