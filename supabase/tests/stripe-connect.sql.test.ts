import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { BOOTSTRAP, initSql, readSql } from "./harness";

const NO_SERVICE_ROLE_AUTO_GRANTS = `
alter default privileges in schema public revoke all on tables from service_role;
alter default privileges in schema public revoke all on functions from service_role;
alter default privileges in schema public revoke all on sequences from service_role;
`;

const MIGRATION = "supabase/migrations/20261112000000_stripe_connect.sql";
const CHECKS = "supabase/tests/stripe_connect_checks.sql";

async function migratedDb(migrationSql = readSql(MIGRATION), autoGrants = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  if (autoGrants === false) {
    // Supabase projects can disable automatic grants: service_role then relies on explicit ones.
    await db.exec(NO_SERVICE_ROLE_AUTO_GRANTS);
  }
  await db.exec(initSql());
  await db.exec(migrationSql);
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
    const results = await db.exec(readSql(CHECKS), {
      onNotice: (n) => notices.push(n.message ?? ""),
    });
    expect(notices).toContain("ALL CHECKS PASSED");
    // The SQL editor shows only the last statement's result, so it must be the pass marker.
    expect(results[results.length - 1].rows).toEqual([{ result: "ALL CHECKS PASSED" }]);
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

  it("passes the checks without automatic service_role grants", { timeout: 60_000 }, async () => {
    db = await migratedDb(readSql(MIGRATION), false);
    const results = await db.exec(readSql(CHECKS));
    expect(results[results.length - 1].rows).toEqual([{ result: "ALL CHECKS PASSED" }]);
  });

  it("fails the checks when reserve_listing logic is broken", { timeout: 60_000 }, async () => {
    const clause = "    where public.listing_holds.expires_at < now();";
    const original = readSql(MIGRATION);
    expect(original).toContain(clause);
    db = await migratedDb(original.replace(clause, "    ;"));
    await expect(db.exec(readSql(CHECKS))).rejects.toThrow(/CHECK FAILED/);
  });
});
