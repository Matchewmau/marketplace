import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { BOOTSTRAP, initSql, readSql } from "./harness";

const NO_SERVICE_ROLE_AUTO_GRANTS = `
alter default privileges in schema public revoke all on tables from service_role;
alter default privileges in schema public revoke all on functions from service_role;
alter default privileges in schema public revoke all on sequences from service_role;
`;

const MIGRATION = "supabase/migrations/20261112000000_stripe_connect.sql";
const REGISTRY_MIGRATION = "supabase/migrations/20261114000000_checkout_session_registry.sql";
const CHECKS = "supabase/tests/stripe_connect_checks.sql";

async function migratedDb(
  migrationSql = readSql(MIGRATION),
  autoGrants = true,
  registrySql = readSql(REGISTRY_MIGRATION),
): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  if (autoGrants === false) {
    // Supabase projects can disable automatic grants: service_role then relies on explicit ones.
    await db.exec(NO_SERVICE_ROLE_AUTO_GRANTS);
  }
  await db.exec(initSql());
  await db.exec(migrationSql);
  await db.exec(registrySql);
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
    // The registry has no foreign key, so a registered session can outlive its listing.
    await db.query(
      "insert into public.checkout_sessions (stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id) values ('cs_missing', '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 2500, 'acct_missing')",
    );
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

  it("applies the registry migration twice without error", { timeout: 60_000 }, async () => {
    db = await migratedDb();
    await db.exec(readSql(REGISTRY_MIGRATION));
  });

  describe("record_paid_order registry guard", () => {
    const ARGS = (overrides: Partial<Record<string, unknown>> = {}) => {
      const a = {
        session: "cs_reg_1",
        pi: "pi_reg_1",
        listing: "",
        buyer: "buyer@example.com",
        amount: 2500,
        fee: 125,
        seller: "acct_reg_1",
        ...overrides,
      };
      return [a.session, a.pi, a.listing, a.buyer, a.amount, a.fee, a.seller];
    };
    const CALL = "select public.record_paid_order($1, $2, $3, $4, $5, $6, $7) as result";

    async function seeded(register = true) {
      const conn = await migratedDb();
      db = conn;
      const { rows } = await conn.query<{ id: string }>(
        "insert into public.listings (title, price, category, seller_email) values ('Lamp', 25, 'Test', 'seller@example.com') returning id",
      );
      const listingId = rows[0].id;
      if (register) {
        await conn.query(
          "insert into public.checkout_sessions (stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id, application_fee_cents) values ('cs_reg_1', $1, gen_random_uuid(), 2500, 'acct_reg_1', 125)",
          [listingId],
        );
      }
      return { conn, listingId };
    }

    async function expectUntouched(conn: PGlite, listingId: string) {
      const listing = await conn.query<{ status: string }>(
        "select status from public.listings where id = $1",
        [listingId],
      );
      expect(listing.rows[0].status).toBe("active");
      const orders = await conn.query<{ n: number }>(
        "select count(*)::int as n from public.orders",
      );
      expect(orders.rows[0].n).toBe(0);
    }

    it("returns unrecognized for a session that is not registered", { timeout: 60_000 }, async () => {
      const { conn, listingId } = await seeded(false);
      const res = await conn.query<{ result: string }>(CALL, ARGS({ listing: listingId }));
      expect(res.rows[0].result).toBe("unrecognized");
      await expectUntouched(conn, listingId);
    });

    it.each([
      ["amount", { amount: 100 }],
      ["seller", { seller: "acct_attacker" }],
      ["fee", { fee: 0 }],
      ["null fee", { fee: null }],
      ["listing", { listing: "00000000-0000-0000-0000-000000000000" }],
    ])("returns unrecognized on %s mismatch", { timeout: 60_000 }, async (_label, override) => {
      const { conn, listingId } = await seeded();
      const res = await conn.query<{ result: string }>(
        CALL,
        ARGS({ listing: listingId, ...override }),
      );
      expect(res.rows[0].result).toBe("unrecognized");
      await expectUntouched(conn, listingId);
    });

    it("records a matching registered session", { timeout: 60_000 }, async () => {
      const { conn, listingId } = await seeded();
      const res = await conn.query<{ result: string }>(CALL, ARGS({ listing: listingId }));
      expect(res.rows[0].result).toBe("recorded");
      const listing = await conn.query<{ status: string }>(
        "select status from public.listings where id = $1",
        [listingId],
      );
      expect(listing.rows[0].status).toBe("sold");
    });

    it("treats a null fee as 0 against a zero-fee registration", { timeout: 60_000 }, async () => {
      const { conn, listingId } = await seeded(false);
      await conn.query(
        "insert into public.checkout_sessions (stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id) values ('cs_reg_1', $1, gen_random_uuid(), 2500, 'acct_reg_1')",
        [listingId],
      );
      const res = await conn.query<{ result: string }>(
        CALL,
        ARGS({ listing: listingId, fee: null }),
      );
      expect(res.rows[0].result).toBe("recorded");
    });

    it("rejects registry rows below the minimum amount", { timeout: 60_000 }, async () => {
      const { conn, listingId } = await seeded(false);
      await expect(
        conn.query(
          "insert into public.checkout_sessions (stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id) values ('cs_low', $1, gen_random_uuid(), 49, 'acct_reg_1')",
          [listingId],
        ),
      ).rejects.toThrow(/check/);
    });
  });
});
