import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");

export const readSql = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");

/** Supabase roles and a minimal storage schema, so the migrations run in PGlite. */
export const BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant anon, authenticated, service_role to current_user;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text);
alter table storage.objects enable row level security;
`;

/** The init migration without `create extension pgcrypto` (PGlite has gen_random_uuid built in). */
export const initSql = () =>
  readSql("supabase/migrations/20261109000000_init_marketplace.sql").replace(
    /^create extension if not exists pgcrypto;\s*$/m,
    "",
  );
