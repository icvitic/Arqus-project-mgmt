import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_MIGRATE_URL ?? 'postgres://arqus:arqus@127.0.0.1:5432/arqus' },
});
