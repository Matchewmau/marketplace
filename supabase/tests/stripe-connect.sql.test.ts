import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const readSql = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");

const BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text);
alter table storage.objects enable row level security;
`;

async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  const init = readSql("supabase/migrations/20261109000000_init_marketplace.sql").replace(
    /^create extension if not exists pgcrypto;\s*$/m,
    "",
  );
  await db.exec(init);
  await db.exec(readSql("supabase/migrations/20261112000000_stripe_connect.sql"));
  return db;
}

describe("stripe connect migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("passes stripe_connect_checks.sql", { timeout: 60_000 }, async () => {
    db = await migratedDb();
    const notices: string[] = [];
    await db.exec(readSql("supabase/tests/stripe_connect_checks.sql"), {
      onNotice: (n) => notices.push(n.message ?? ""),
    });
    expect(notices).toContain("ALL CHECKS PASSED");
    // The script rolls back, leaving no data.
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.orders");
    expect(rows[0].n).toBe(0);
  });

  it("rejects record_paid_order for a missing listing", { timeout: 60_000 }, async () => {
    db = await migratedDb();
    await expect(
      db.query("select public.record_paid_order($1, $2, $3, $4, $5, $6, $7)", [
        "cs_missing",
        "pi_missing",
        "00000000-0000-0000-0000-000000000000",
        "buyer@example.com",
        2500,
        0,
        "acct_missing",
      ]),
    ).rejects.toThrow(/not found/);
  });
});
