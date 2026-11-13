import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { isCategoryName } from "@/lib/categories";
import { isCondition } from "@/lib/conditions";
import { STRIPE_MIN_CHARGE_CENTS } from "@/lib/stripe/amount";

import { BOOTSTRAP, initSql, readSql } from "./harness";

type SeedRow = {
  id: string;
  title: string;
  price: string;
  category: string;
  condition: string;
  seller_email: string;
  image_url: string | null;
  location: string | null;
  status: string;
  created_at: Date;
};

const SEED = readSql("supabase/seed.sql");

/** README order: init migration, seed, then the Stripe Connect migration. */
async function seededDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(initSql());
  await db.exec(SEED);
  await db.exec(readSql("supabase/migrations/20261112000000_stripe_connect.sql"));
  return db;
}

describe("supabase/seed.sql", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("loads 24 valid, buyable sample listings in the README order", { timeout: 60_000 }, async () => {
    db = await seededDb();
    const { rows } = await db.query<SeedRow>("select * from public.listings order by created_at desc");

    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((r) => r.title)).size).toBe(24);

    for (const row of rows) {
      expect(isCategoryName(row.category), `${row.title}: category ${row.category}`).toBe(true);
      expect(isCondition(row.condition), `${row.title}: condition ${row.condition}`).toBe(true);
      expect(Math.round(Number(row.price) * 100)).toBeGreaterThanOrEqual(STRIPE_MIN_CHARGE_CENTS);
      expect(row.seller_email).toMatch(/^demo\.seller[1-4]@example\.com$/);
      expect(row.image_url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?/);
      expect(row.location).toMatch(/, CA$/);
      expect(row.status).toBe("active");
      expect(row.created_at.getTime()).toBeLessThan(Date.now());
    }

    const perSeller = new Map<string, number>();
    for (const row of rows) perSeller.set(row.seller_email, (perSeller.get(row.seller_email) ?? 0) + 1);
    expect([...perSeller.values()]).toEqual([6, 6, 6, 6]);
  });

  it("can be run again without duplicating listings", { timeout: 60_000 }, async () => {
    db = await seededDb();
    await db.exec(SEED);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.listings");
    expect(rows[0].n).toBe(24);
  });
});
