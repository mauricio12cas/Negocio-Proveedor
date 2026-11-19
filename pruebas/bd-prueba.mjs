// Crea un Postgres en memoria (PGlite) con lo mínimo de Supabase y aplica las migraciones.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dirMigraciones = new URL('../supabase/migrations/', import.meta.url);

export async function crearBD() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  for (const archivo of readdirSync(dirMigraciones).sort()) {
    await db.exec(readFileSync(new URL(archivo, dirMigraciones), 'utf8'));
  }
  return db;
}
